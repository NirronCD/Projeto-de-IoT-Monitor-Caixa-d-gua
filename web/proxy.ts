import { NextResponse, type NextRequest } from "next/server";
import { iguaisSeguro } from "@/lib/seguranca";

export function proxy(req: NextRequest) {
  const usuario = process.env.PAINEL_USUARIO;
  const senha = process.env.PAINEL_SENHA;
  if (!usuario || !senha) {
    return new NextResponse("Servidor sem PAINEL_USUARIO/PAINEL_SENHA configurados", { status: 500 });
  }

  const [tipo, valor] = (req.headers.get("authorization") ?? "").split(" ");
  if (tipo === "Basic" && valor) {
    const texto = Buffer.from(valor, "base64").toString("utf8");
    const sep = texto.indexOf(":");
    const u = texto.slice(0, sep);
    const s = texto.slice(sep + 1);
    const usuarioOk = iguaisSeguro(u, usuario);
    const senhaOk = iguaisSeguro(s, senha);
    if (sep >= 0 && usuarioOk && senhaOk) return NextResponse.next();
  }

  return new NextResponse("Login necessário", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Caixa d\'Agua", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!api/leituras|_next/static|_next/image|favicon.ico).*)"],
};
