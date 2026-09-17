import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const baseProps: IconProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

export function SearchIcon(props: IconProps) {
  return <svg {...baseProps} {...props}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>;
}

export function PlusIcon(props: IconProps) {
  return <svg {...baseProps} {...props}><path d="M12 5v14M5 12h14" /></svg>;
}

export function BookIcon(props: IconProps) {
  return <svg {...baseProps} {...props}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5z" /><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z" /></svg>;
}

export function CrosshairIcon(props: IconProps) {
  return <svg {...baseProps} {...props}><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>;
}

export function MapIcon(props: IconProps) {
  return <svg {...baseProps} {...props}><path d="m3 6 5-3 8 3 5-3v15l-5 3-8-3-5 3z" /><path d="M8 3v15M16 6v15" /></svg>;
}

export function ShieldIcon(props: IconProps) {
  return <svg {...baseProps} {...props}><path d="M12 3 20 6v5c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6z" /></svg>;
}

export function GrenadeIcon(props: IconProps) {
  return <svg {...baseProps} {...props}><path d="M9 7h7l2 4v6a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4v-6z" /><path d="M10 7V4h5v3M15 4l3-1M18 3l2 2M8 12h8M8 16h8" /></svg>;
}

export function PencilIcon(props: IconProps) {
  return <svg {...baseProps} {...props}><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z" /><path d="m14 7 3 3" /></svg>;
}

export function TrashIcon(props: IconProps) {
  return <svg {...baseProps} {...props}><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" /></svg>;
}

export function ImageIcon(props: IconProps) {
  return <svg {...baseProps} {...props}><rect x="3" y="4" width="18" height="16" rx="1" /><circle cx="9" cy="9" r="1.5" /><path d="m3 16 5-5 4 4 3-3 6 6" /></svg>;
}

export function DatabaseIcon(props: IconProps) {
  return <svg {...baseProps} {...props}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" /></svg>;
}

export function ChevronRightIcon(props: IconProps) {
  return <svg {...baseProps} {...props}><path d="m9 18 6-6-6-6" /></svg>;
}
