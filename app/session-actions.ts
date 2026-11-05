"use server";
import { redirect } from "next/navigation";
import { destroySession, getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function logoutAction() {
  const u = await getCurrentUser();
  await destroySession();
  if (u) await audit(u.id, "auth", u.id, "logout");
  redirect("/login");
}
