import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "./ui";

const Schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().optional(),
});
type Form = z.infer<typeof Schema>;

export function Login() {
  const [mode, setMode] = useState<"password" | "magic" | "signup">("password");
  const [sent, setSent] = useState(false);
  const { register, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(Schema) });
  const onSubmit = async ({ email, password }: Form) => {
    const redirect = window.location.origin;
    if (mode === "magic") {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirect },
      });
      if (error) return toast.error(error.message);
      setSent(true);
      return;
    }
    if (!password || password.length < 8)
      return toast.error("Password must be at least 8 characters");
    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirect },
      });
      if (error) return toast.error(error.message);
      if (!data.session) setSent(true);
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) toast.error(error.message);
  };
  return (
    <div className="grid min-h-screen place-items-center bg-surface-0 px-4">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg border border-line-gold bg-surface-2 font-bold text-gold-400">
            H
          </div>
          <div>
            <div className="font-display text-[20px] font-semibold tracking-[-0.01em]">
              HermesAgents
            </div>
            <div className="t-label">Sonic-class gold operations console</div>
          </div>
        </div>
        <div className="panel p-6">
          {sent ? (
            <div className="space-y-2">
              <div className="font-semibold">Check your inbox</div>
              <p className="text-ink-1">
                We sent a link to finish signing in. It opens this console.
              </p>
              <Button variant="quiet" size="sm" onClick={() => setSent(false)}>
                Back
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="flex gap-1 rounded-md bg-surface-0 p-1">
                {(["password", "magic", "signup"] as const).map((m) => (
                  <button
                    type="button"
                    key={m}
                    onClick={() => setMode(m)}
                    className={`flex-1 rounded px-2 py-1.5 text-[12px] ${mode === m ? "bg-surface-3 text-ink-0" : "text-ink-2"}`}
                  >
                    {m === "password"
                      ? "Sign in"
                      : m === "magic"
                        ? "Magic link"
                        : "Create operator"}
                  </button>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label>Operator email</Label>
                <Input
                  type="email"
                  autoComplete="email"
                  {...register("email")}
                  className="border-line-1 bg-surface-0"
                />
                {formState.errors.email && (
                  <p className="text-[12px] text-neg">{formState.errors.email.message}</p>
                )}
              </div>
              {mode !== "magic" && (
                <div className="space-y-1.5">
                  <Label>Password</Label>
                  <Input
                    type="password"
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    {...register("password")}
                    className="border-line-1 bg-surface-0"
                  />
                </div>
              )}
              <Button
                type="submit"
                variant="gold"
                className="w-full"
                disabled={formState.isSubmitting}
              >
                {mode === "magic"
                  ? "Email me a sign-in link"
                  : mode === "signup"
                    ? "Create operator account"
                    : "Sign in"}
              </Button>
              <p className="text-[12px] leading-5 text-ink-2">
                A new operator starts with all four agents in RESEARCH, equal budgets and a seeded
                simulation feed.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
