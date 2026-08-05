import { cn } from "@/lib/utils";

export type AppShellIconName =
  | "compass"
  | "layout-dashboard"
  | "strategy"
  | "publishing"
  | "wallet";

export function AppShellNavIcon({ name }: { readonly name: AppShellIconName }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "compass") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10" />
        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
      </svg>
    );
  }

  if (name === "layout-dashboard") {
    return (
      <svg {...common}>
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <path d="M3 9h18" />
        <path d="M9 21V9" />
      </svg>
    );
  }

  if (name === "wallet") {
    return (
      <svg {...common}>
        <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h13A2.5 2.5 0 0 1 21 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z" />
        <path d="M3 8h15.5A2.5 2.5 0 0 1 21 10.5V13h-4a2 2 0 0 1 0-4h4" />
        <path d="M17 11h.01" />
      </svg>
    );
  }

  if (name === "publishing") {
    return (
      <svg {...common}>
        <path d="M4 5h16v14H4z" />
        <path d="M4 9h16" />
        <path d="M8 13h4" />
        <path d="M8 16h7" />
        <path d="m16 13 2-2 2 2" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="m7 15 3-3 3 2 4-6" />
      <path d="M16 8h1v1" />
    </svg>
  );
}

export function AppShellChevronIcon({
  collapsed,
}: {
  readonly collapsed: boolean;
}) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        "transition-transform rtl:scale-x-[-1]",
        collapsed && "rotate-180",
      )}
      aria-hidden="true"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function AppShellMenuIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

export function AppShellCloseIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
