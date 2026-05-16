import { redirect } from "next/navigation";
import { FileManager } from "@/components/file-manager";
import { hasValidSession } from "@/lib/session";

export default async function FilesPage() {
  if (!(await hasValidSession())) {
    redirect("/login");
  }

  return <FileManager />;
}
