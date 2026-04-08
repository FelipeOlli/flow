"use client";

import { signIn } from "next-auth/react";
import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";

function SignInForm() {
  const searchParams = useSearchParams();
  const hasError = searchParams.get("error") !== null;

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(hasError ? "Usuário ou senha incorretos." : "");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    setError("");
    const result = await signIn("credentials", {
      username: username.trim(),
      password,
      callbackUrl: "/today",
      redirect: false,
    });
    if (result?.error) {
      setError("Usuário ou senha incorretos.");
      setLoading(false);
    } else if (result?.url) {
      window.location.href = result.url;
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="text-center flex flex-col items-center">
          <Image
            src="/logo.png"
            alt="FLOW"
            width={300}
            height={300}
            priority
            className="drop-shadow-[0_0_24px_rgba(79,142,247,0.3)]"
          />
          <p className="mt-2 text-gray-400 text-base">
            Suas tarefas. Seu ritmo.
          </p>
        </div>

        {/* Sign in card */}
        <div className="bg-gray-900 rounded-3xl p-8 border border-gray-800 space-y-5">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold text-white">Entrar</h2>
            <p className="text-sm text-gray-500">
              Acesse com suas credenciais
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="text"
              placeholder="Usuário"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className="w-full bg-gray-800 text-white placeholder-gray-500 rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 border border-gray-700"
            />
            <input
              type="password"
              placeholder="Senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full bg-gray-800 text-white placeholder-gray-500 rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 border border-gray-700"
            />
            {error && (
              <p className="text-sm text-red-400">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading || !username.trim() || !password}
              className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium py-3 px-6 rounded-2xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
