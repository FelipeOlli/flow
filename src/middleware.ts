export { auth as middleware } from "@/auth";

export const config = {
  matcher: [
    "/((?!sign-in|api/auth|api/health|_next/static|_next/image|favicon.ico).*)",
  ],
};
