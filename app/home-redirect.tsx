"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { getHealthStorageState } from "@/lib/browser-storage";

export function HomeRedirect() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const storageState = await getHealthStorageState();
        if (!cancelled && storageState !== "empty") router.replace("/explore");
      } catch {
        // Stay on the landing page if local storage cannot be inspected.
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
