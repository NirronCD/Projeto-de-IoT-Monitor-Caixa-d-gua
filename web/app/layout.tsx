import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Caixa d'Água",
  description: "Monitor Inteligente de Caixa d'Água",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
