"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Petromin Auto Care logo colours on white. Black vs orange: CVD ΔE 48, normal ΔE 56 (validate_palette.js);
// orange is below 3:1 on white, so every series also has a legend label and a hover value.
const SERIES = { s1: "#171614", s2: "#fb8606", s3: "#ce102c" };
// Status palette (reserved meaning; always paired with legend labels).
const STATUS = { completed: "#16a34a", onTrack: "#b4b1ad", overdue: "#ce102c" };
const AXIS = { stroke: "#e4e3e1", tick: { fill: "#6e6b67", fontSize: 11 } };
const GRID = "#efeeec";

function TooltipBox({ active, payload, label, suffix = "" }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; suffix?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-fg">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-fg-2">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />
          {p.name}: <span className="tabular-nums text-fg">{p.value}{suffix}</span>
        </p>
      ))}
    </div>
  );
}

const legendStyle = { fontSize: 12, color: "#3c3a37", paddingTop: 8 };

export function TrendChart({ data }: { data: { month: string; created: number; completed: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="month" {...AXIS} tickLine={false} />
        <YAxis allowDecimals={false} {...AXIS} tickLine={false} axisLine={false} />
        <Tooltip content={<TooltipBox />} cursor={{ stroke: "#cbc9c6" }} />
        <Legend wrapperStyle={legendStyle} iconType="plainline" />
        <Line type="monotone" dataKey="created" name="Created" stroke={SERIES.s1} strokeWidth={2.5} dot={false} activeDot={{ r: 4, stroke: "#ffffff", strokeWidth: 2 }} />
        <Line type="monotone" dataKey="completed" name="Completed" stroke={SERIES.s2} strokeWidth={2.5} dot={false} activeDot={{ r: 4, stroke: "#ffffff", strokeWidth: 2 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function StatusStack({ data, height }: { data: { name: string; completed: number; onTrack: number; overdue: number }[]; height?: number }) {
  const h = height ?? Math.max(120, data.length * 34 + 60);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barCategoryGap={8}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" allowDecimals={false} {...AXIS} tickLine={false} />
        <YAxis type="category" dataKey="name" width={130} {...AXIS} tickLine={false} axisLine={false} />
        <Tooltip content={<TooltipBox />} cursor={{ fill: "rgba(23,22,20,0.04)" }} />
        <Legend wrapperStyle={legendStyle} iconType="square" />
        <Bar dataKey="completed" name="Completed" stackId="s" fill={STATUS.completed} stroke="#ffffff" strokeWidth={2} />
        <Bar dataKey="onTrack" name="Open – on track" stackId="s" fill={STATUS.onTrack} stroke="#ffffff" strokeWidth={2} />
        <Bar dataKey="overdue" name="Overdue" stackId="s" fill={STATUS.overdue} stroke="#ffffff" strokeWidth={2} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SingleBars({ data, dataKey, name, suffix = "", color = SERIES.s1, max, height }: { data: Record<string, string | number>[]; dataKey: string; name: string; suffix?: string; color?: string; max?: number; height?: number }) {
  const h = height ?? Math.max(120, data.length * 32 + 30);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap={8}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" allowDecimals={false} domain={max ? [0, max] : undefined} {...AXIS} tickLine={false} />
        <YAxis type="category" dataKey="name" width={130} {...AXIS} tickLine={false} axisLine={false} />
        <Tooltip content={<TooltipBox suffix={suffix} />} cursor={{ fill: "rgba(23,22,20,0.04)" }} />
        <Bar dataKey={dataKey} name={name} fill={color} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export const CHART_COLORS = { ...SERIES, critical: STATUS.overdue };
