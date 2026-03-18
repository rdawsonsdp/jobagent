"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Briefcase,
  LayoutDashboard,
  FileText,
  Settings,
  Activity,
  Building2,
  Mail,
} from "lucide-react";
import UserMenu from "./UserMenu";

const navItems = [
  { href: "/jobs", label: "Job Pipeline", icon: Briefcase },
  { href: "/email-agent", label: "Email Agent", icon: Mail },
  { href: "/resume", label: "Resume", icon: FileText },
  { href: "/crawl-log", label: "Crawl Log", icon: Activity },
  { href: "/companies", label: "Discover", icon: Building2 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 bg-sidebar text-sidebar-foreground flex flex-col h-screen fixed left-0 top-0">
      <div className="p-4 border-b border-white/10">
        <Link href="/jobs" className="flex items-center gap-2">
          <LayoutDashboard className="w-6 h-6 text-accent" />
          <span className="font-bold text-lg">JobSearch</span>
        </Link>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-white/10"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <UserMenu />
    </aside>
  );
}
