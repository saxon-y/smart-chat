import ChatWorkspace from "@/components/ChatWorkspace";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";

export default async function ChatPage() {
  if (!(await getCurrentUser())) redirect("/login");
  return <ChatWorkspace />;
}
