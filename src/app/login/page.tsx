import AuthForm from "@/components/AuthForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const error = (await searchParams).error;
  return <AuthForm mode="login" oauthError={typeof error === "string" ? error : undefined} />;
}
