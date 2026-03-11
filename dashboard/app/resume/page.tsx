"use client";

import { useState, useCallback, useRef } from "react";
import { useResume } from "@/lib/hooks/useResume";
import { toast } from "sonner";
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  Briefcase,
  Award,
  Target,
  Tag,
} from "lucide-react";

export default function ResumePage() {
  const { resume, loading: resumeLoading, refetch } = useResume();
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(
    async (file: File) => {
      const accepted = [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ];
      if (!accepted.includes(file.type)) {
        toast.error("Please upload a PDF or DOCX file.");
        return;
      }

      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/resume", { method: "POST", body: formData });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error ?? "Upload failed");
        }

        toast.success("Resume uploaded and parsed successfully!");
        refetch();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Upload failed";
        toast.error(message);
      } finally {
        setUploading(false);
      }
    },
    [refetch]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) uploadFile(file);
    },
    [uploadFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) uploadFile(file);
    },
    [uploadFile]
  );

  const parsedData = resume?.parsed_data as {
    skills?: string[];
    target_titles?: string[];
    years_of_experience?: number;
    certifications?: string[];
    preferred_keywords?: string[];
    summary?: string;
  } | null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <FileText className="w-6 h-6 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Resume</h1>
            <p className="text-sm text-gray-500">
              Upload your resume to improve job matching
            </p>
          </div>
        </div>

        {/* Drop Zone */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`relative rounded-xl border-2 border-dashed p-12 text-center transition-all cursor-pointer ${
            dragOver
              ? "border-blue-400 bg-blue-50"
              : "border-gray-300 bg-white hover:border-gray-400 hover:bg-gray-50"
          } ${uploading ? "pointer-events-none opacity-60" : ""}`}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx"
            onChange={handleFileChange}
            className="hidden"
          />

          {uploading ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
              <p className="text-sm font-medium text-gray-700">
                Parsing your resume...
              </p>
              <p className="text-xs text-gray-400">
                This may take a moment while we extract your information.
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-full bg-blue-50 p-4">
                <Upload className="w-8 h-8 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700">
                  Drop your resume here or click to browse
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Accepts .pdf and .docx files
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Loading state for resume data */}
        {resumeLoading && (
          <div className="mt-8 flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
            <span className="ml-2 text-sm text-gray-500">Loading resume data...</span>
          </div>
        )}

        {/* Parsed resume data */}
        {!resumeLoading && resume && parsedData && (
          <div className="mt-8 space-y-6">
            {/* Status banner */}
            <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 p-3">
              <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
              <p className="text-sm text-green-700">
                Resume parsed successfully
                {resume.updated_at &&
                  ` on ${new Date(resume.updated_at).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}`}
              </p>
            </div>

            {/* Summary */}
            {parsedData.summary && (
              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-2">Summary</h2>
                <p className="text-sm text-gray-700 leading-relaxed">
                  {parsedData.summary}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Skills */}
              {parsedData.skills && parsedData.skills.length > 0 && (
                <div className="rounded-xl border border-gray-200 bg-white p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Tag className="w-5 h-5 text-blue-600" />
                    <h2 className="text-lg font-semibold text-gray-900">Skills</h2>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {parsedData.skills.map((skill, i) => (
                      <span
                        key={i}
                        className="inline-block rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Target Titles */}
              {parsedData.target_titles && parsedData.target_titles.length > 0 && (
                <div className="rounded-xl border border-gray-200 bg-white p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Target className="w-5 h-5 text-purple-600" />
                    <h2 className="text-lg font-semibold text-gray-900">Target Titles</h2>
                  </div>
                  <ul className="space-y-1.5">
                    {parsedData.target_titles.map((title, i) => (
                      <li
                        key={i}
                        className="text-sm text-gray-700 flex items-center gap-2"
                      >
                        <Briefcase className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                        {title}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Experience */}
              {parsedData.years_of_experience != null && (
                <div className="rounded-xl border border-gray-200 bg-white p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-2">Experience</h2>
                  <p className="text-3xl font-bold text-gray-900">
                    {parsedData.years_of_experience}
                    <span className="text-lg font-normal text-gray-500 ml-1">years</span>
                  </p>
                </div>
              )}

              {/* Certifications */}
              {parsedData.certifications && parsedData.certifications.length > 0 && (
                <div className="rounded-xl border border-gray-200 bg-white p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Award className="w-5 h-5 text-amber-600" />
                    <h2 className="text-lg font-semibold text-gray-900">Certifications</h2>
                  </div>
                  <ul className="space-y-1.5">
                    {parsedData.certifications.map((cert, i) => (
                      <li
                        key={i}
                        className="text-sm text-gray-700 flex items-center gap-2"
                      >
                        <Award className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        {cert}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Preferred Keywords */}
            {parsedData.preferred_keywords &&
              parsedData.preferred_keywords.length > 0 && (
                <div className="rounded-xl border border-gray-200 bg-white p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-3">
                    Preferred Keywords
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    {parsedData.preferred_keywords.map((kw, i) => (
                      <span
                        key={i}
                        className="inline-block rounded-md bg-gray-100 px-2.5 py-1 text-sm text-gray-700"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}
          </div>
        )}
      </div>
    </div>
  );
}
