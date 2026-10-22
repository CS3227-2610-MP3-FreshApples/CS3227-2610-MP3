"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AdminHeaderAccountControl } from "../../../components/admin-header-account-control";
import { adminLogout, getAdminAccount, type AdminAccount } from "../_lib/admin-http";

export const logoutAdmin = adminLogout;

export function AdminAccountControl() {
  const router = useRouter();
  const [account, setAccount] = useState<AdminAccount | null>(null);

  useEffect(() => {
    let active = true;
    void getAdminAccount(fetch)
      .then((result) => {
        if (!active) return;
        if (!result.ok) {
          router.replace("/sign-in");
          return;
        }
        setAccount(result.value);
      })
      .catch(() => {
        if (active) router.replace("/sign-in");
      });
    return () => { active = false; };
  }, [router]);

  return <AdminHeaderAccountControl displayName={account?.displayName ?? "Loading account…"} />;
}
