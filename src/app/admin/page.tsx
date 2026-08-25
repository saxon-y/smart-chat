import AdminConsole from "@/components/admin/AdminConsole";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { isUserAdmin } from "@/lib/auth/permissions";

export default async function AdminRoute() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await isUserAdmin(user.id, user.role))) redirect("/chat");
  return <AdminConsole />;
}
