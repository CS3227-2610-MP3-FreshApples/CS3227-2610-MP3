import type { Metadata } from "next";
import "./globals.css";

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
        {children}
      </body>
    </html>
  );
}
