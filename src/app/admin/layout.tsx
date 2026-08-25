import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { isUserAdmin } from "@/lib/auth/permissions";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await isUserAdmin(user.id, user.role))) redirect("/chat");
  return children;
}
