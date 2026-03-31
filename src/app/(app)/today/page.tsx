import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { CalendarView } from "@/components/calendar/CalendarView";

export const dynamic = "force-dynamic";

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await auth();
  if (!session?.accessToken) redirect("/sign-in");
  if (session.error === "RefreshAccessTokenError") redirect("/sign-in");

  const params = await searchParams;
  return <CalendarView initialDate={params.date} />;
}
