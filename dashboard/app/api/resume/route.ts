import { NextRequest, NextResponse } from "next/server";
import { extractText } from "unpdf";
import mammoth from "mammoth";
import { createServiceRoleClient } from "@/lib/supabase/server";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

const ACCEPTED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const PARSE_PROMPT = `You are a resume parser. Analyze the following resume text and extract structured information.

Return ONLY valid JSON with this exact schema (no markdown, no explanation):
{
  "skills": ["string array of technical and soft skills"],
  "target_titles": ["string array of job titles this person is qualified for"],
  "years_of_experience": number,
  "certifications": ["string array of certifications or licenses"],
  "preferred_keywords": ["string array of keywords that describe their expertise and interests"],
  "summary": "A 2-3 sentence professional summary"
}

Resume text:
`;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!ACCEPTED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Only PDF and DOCX files are accepted" },
        { status: 400 }
      );
    }

    // Extract text from PDF or DOCX
    const arrayBuffer = await file.arrayBuffer();
    let resumeText: string;

    if (file.type === "application/pdf") {
      const uint8 = new Uint8Array(arrayBuffer);
      const { text: pages } = await extractText(uint8);
      resumeText = pages.join("\n\n");
    } else {
      const result = await mammoth.extractRawText({ buffer: Buffer.from(arrayBuffer) });
      resumeText = result.value;
    }

    if (!resumeText || resumeText.trim().length === 0) {
      return NextResponse.json(
        { error: "Could not extract text from PDF" },
        { status: 400 }
      );
    }

    // Call Anthropic API to parse resume
    const anthropicResponse = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2048,
          messages: [
            {
              role: "user",
              content: PARSE_PROMPT + resumeText.slice(0, 15000),
            },
          ],
        }),
      }
    );

    if (!anthropicResponse.ok) {
      const errBody = await anthropicResponse.text();
      console.error("Anthropic API error:", errBody);
      return NextResponse.json(
        { error: "Failed to parse resume with AI" },
        { status: 500 }
      );
    }

    const anthropicData = await anthropicResponse.json();
    const rawContent = anthropicData.content?.[0]?.text ?? "";

    // Parse the JSON response
    let parsedData;
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }
      parsedData = JSON.parse(jsonMatch[0]);
    } catch {
      console.error("Failed to parse AI response:", rawContent);
      return NextResponse.json(
        { error: "Failed to parse AI response into structured data" },
        { status: 500 }
      );
    }

    // Store in Supabase
    const supabase = await createServiceRoleClient();

    // Deactivate old resumes, then insert new one
    await supabase
      .from("resumes")
      .update({ is_active: false })
      .eq("is_active", true);

    const { data: resume, error: dbError } = await supabase
      .from("resumes")
      .insert({
        file_name: file.name,
        raw_text: resumeText,
        parsed_data: parsedData,
        skills: parsedData.skills ?? [],
        target_titles: parsedData.target_titles ?? [],
        preferences: { preferred_keywords: parsedData.preferred_keywords ?? [] },
        is_active: true,
      })
      .select()
      .single();

    if (dbError) {
      console.error("Supabase error:", dbError);
      return NextResponse.json(
        { error: "Failed to store resume" },
        { status: 500 }
      );
    }

    return NextResponse.json(resume);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Resume upload error:", message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
