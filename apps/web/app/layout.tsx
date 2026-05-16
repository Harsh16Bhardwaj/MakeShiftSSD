import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PersonalCloud",
  description: "Private file manager for a secondary PC storage server.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
