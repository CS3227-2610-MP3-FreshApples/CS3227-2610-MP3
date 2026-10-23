import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "../components/auth-context";

export const metadata: Metadata = {
  title: "FreshApples Movie Reviews",
  description: "Browse movies and community reviews.",
};

type RootLayoutProps = Readonly<{
  children: React.ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
