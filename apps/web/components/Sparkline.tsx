// 작은 추이선. values[0]이 오늘(실선), 이후는 예측(점선). null(해당 없음)인 날은 선을 끊는다.
export default function Sparkline({ values, width = 160, height = 40, label, fluid = false }: { values: (number | null)[]; width?: number; height?: number; label?: string; fluid?: boolean }) {
  if (!values.length || values.every((v) => v == null)) return null;
  const max = 100;
  const step = width / Math.max(1, values.length - 1);
  const pad = 3; // 0·100 값이 테두리에 붙어 잘리지 않도록
  const y = (v: number) => pad + (1 - Math.max(0, Math.min(max, v)) / max) * (height - pad * 2);

  // [from, to] 구간을 null에서 끊어 SVG path로
  const path = (from: number, to: number) => {
    let d = "";
    let pen = false;
    for (let i = from; i <= to && i < values.length; i++) {
      const v = values[i];
      if (v == null) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${(i * step).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const thresholds = [25, 50, 75];
  const aria = label ?? `위험지수 추이 ${values.map((v) => (v == null ? "해당 없음" : Math.round(v))).join(", ")}`;
  return (
    <svg
      width={fluid ? "100%" : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={fluid ? "none" : undefined}
      role="img"
      aria-label={aria}
      className="block overflow-visible"
    >
      {thresholds.map((t) => (
        <line key={t} x1="0" x2={width} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
      ))}
      <path d={path(0, 1)} fill="none" stroke="#1f6f4a" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <path d={path(1, values.length - 1)} fill="none" stroke="#1f6f4a" strokeWidth="2" strokeDasharray="4 3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {values[0] != null && !fluid && <circle cx={0} cy={y(values[0])} r="3" fill="#1f6f4a" />}
    </svg>
  );
}
