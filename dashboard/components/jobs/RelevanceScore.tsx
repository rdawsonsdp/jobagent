"use client";

interface RelevanceScoreProps {
  score: number;
  size?: "sm" | "md" | "lg";
}

export default function RelevanceScore({ score, size = "md" }: RelevanceScoreProps) {
  const clampedScore = Math.min(10, Math.max(0, score));

  const getColor = (s: number) => {
    if (s < 4) return { ring: "stroke-red-500", text: "text-red-600", bg: "bg-red-50" };
    if (s <= 6) return { ring: "stroke-yellow-500", text: "text-yellow-600", bg: "bg-yellow-50" };
    return { ring: "stroke-green-500", text: "text-green-600", bg: "bg-green-50" };
  };

  const sizeMap = {
    sm: { container: "w-10 h-10", textSize: "text-xs", strokeWidth: 3, radius: 16 },
    md: { container: "w-14 h-14", textSize: "text-sm", strokeWidth: 3.5, radius: 22 },
    lg: { container: "w-20 h-20", textSize: "text-lg", strokeWidth: 4, radius: 32 },
  };

  const colors = getColor(clampedScore);
  const s = sizeMap[size];
  const circumference = 2 * Math.PI * s.radius;
  const progress = (clampedScore / 10) * circumference;
  const viewBoxSize = (s.radius + s.strokeWidth) * 2;
  const center = viewBoxSize / 2;

  return (
    <div
      className={`relative inline-flex items-center justify-center ${s.container} ${colors.bg} rounded-full`}
      title={`Relevance score: ${clampedScore}/10`}
    >
      <svg
        className="absolute inset-0 -rotate-90"
        viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
        fill="none"
      >
        <circle
          cx={center}
          cy={center}
          r={s.radius}
          strokeWidth={s.strokeWidth}
          className="stroke-gray-200"
        />
        <circle
          cx={center}
          cy={center}
          r={s.radius}
          strokeWidth={s.strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          strokeLinecap="round"
          className={colors.ring}
        />
      </svg>
      <span className={`relative font-bold ${s.textSize} ${colors.text}`}>
        {clampedScore.toFixed(1)}
      </span>
    </div>
  );
}
