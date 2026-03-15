"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { LogOut, User } from "lucide-react";

export default function UserMenu() {
  const [email, setEmail] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setEmail(user?.email ?? null);
    });
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (!email) return null;

  return (
    <div className="p-3 border-t border-white/10">
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        <User className="w-4 h-4 opacity-60 flex-shrink-0" />
        <span className="truncate opacity-80" title={email}>
          {email}
        </span>
      </div>
      <button
        onClick={handleSignOut}
        className="flex items-center gap-2 px-3 py-2 text-sm w-full rounded-lg hover:bg-white/10 transition-colors text-red-300 hover:text-red-200"
      >
        <LogOut className="w-4 h-4" />
        Sign Out
      </button>
    </div>
  );
}
