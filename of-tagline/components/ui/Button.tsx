// components/ui/Button.tsx
import React from "react";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  color?: "black" | "orange";
};

export function Button({ color = "black", className = "", ...props }: Props) {
  const base =
    "inline-flex items-center justify-center rounded-2xl px-4 py-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition";
  const theme =
    color === "orange"
      ? "bg-orange-500 text-white hover:opacity-90"
      : "bg-black text-white hover:opacity-90";
  return <button className={`${base} ${theme} ${className}`} {...props} />;
}
