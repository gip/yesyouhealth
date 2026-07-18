import { NextResponse } from "next/server";

import { auth } from "@/auth";

export const config = {
  matcher: ["/doctor/:path*", "/patient/:path*", "/explore", "/callback", "/onboarding"],
};

const PATIENT_ONLY_PREFIXES = ["/patient", "/explore", "/callback"];

export default auth((request) => {
  const { nextUrl } = request;
  const pathname = nextUrl.pathname;
  const session = request.auth;

  if (!session?.user) {
    const signInUrl = new URL("/signin", nextUrl);
    signInUrl.searchParams.set("callbackUrl", nextUrl.pathname + nextUrl.search);
    return NextResponse.redirect(signInUrl);
  }

  const role = session.user.role;
  if (role === null) {
    if (pathname === "/onboarding") return NextResponse.next();
    return NextResponse.redirect(new URL("/onboarding", nextUrl));
  }

  if (pathname === "/onboarding") {
    return NextResponse.redirect(new URL(role === "doctor" ? "/doctor" : "/patient", nextUrl));
  }
  if (role === "patient" && pathname.startsWith("/doctor")) {
    return NextResponse.redirect(new URL("/patient", nextUrl));
  }
  if (role === "doctor" && PATIENT_ONLY_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.redirect(new URL("/doctor", nextUrl));
  }
  return NextResponse.next();
});
