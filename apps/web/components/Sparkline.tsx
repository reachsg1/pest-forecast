// 작은 추이선. values[0]이 오늘, 이후는 예측(점선).
export default function Sparkline({ values, width = 160, height = 40, label }: { values: number[]; width?: number; height?: number; label?: string }) {
  if (!values.length) return null;
  const max = 100;
  const step = width / Math.max(1, values.length - 1);
  const pt = (v: number, i: number) => `${(i * step).toFixed(1)},${(height - (Math.max(0, Math.min(max, v)) / max) * height).toFixed(1)}`;
  const first = values.slice(0, 2).map(pt).join(" ");
  const rest = values.slice(1).map((v, i) => pt(v, i + 1)).join(" ");
  const thresholds = [25, 50, 75];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label ?? `위험지수 추이 ${values.map((v) => Math.round(v)).join(", ")}`}>
      {thresholds.map((t) => (
        <line key={t} x1="0" x2={width} y1={height - (t / max) * height} y2={height - (t / max) * height} stroke="#e5e7eb" strokeDasharray="2 2" />
      ))}
      <polyline points={first} fill="none" stroke="#1f6f4a" strokeWidth="2" />
      <polyline points={rest} fill="none" stroke="#1f6f4a" strokeWidth="2" strokeDasharray="4 3" />
      <circle cx={0} cy={height - (Math.max(0, Math.min(max, values[0])) / max) * height} r="3" fill="#1f6f4a" />
    </svg>
  );
}
