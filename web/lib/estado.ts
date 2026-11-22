import { z } from "zod";

export const leituraSchema = z
  .object({
    distancia_cm: z.number().min(0).max(1000).nullable(),
    nivel: z.number().int().min(0).max(100).nullable(),
    sensor_ok: z.boolean(),
    bomba: z.enum(["ligada", "desligada"]),
    modo: z.enum(["auto", "manual"]),
    limite_min: z.number().int(),
    limite_max: z.number().int(),
    rssi: z.number().int(),
    uptime_s: z.number().int().min(0),
  })
  .refine((l) => !l.sensor_ok || (l.nivel !== null && l.distancia_cm !== null), {
    message: "com sensor_ok = true, nivel e distancia_cm são obrigatórios",
  });

const camposConfig = z.object({
  modo: z.enum(["auto", "manual"]),
  bomba_manual: z.enum(["ligada", "desligada"]),
  limite_min: z.number().int().min(5).max(80),
  limite_max: z.number().int().min(20).max(95),
});

export const configSchema = camposConfig.refine((c) => c.limite_max - c.limite_min >= 10, {
  message: "limite_max precisa ser pelo menos 10 pontos maior que limite_min",
});

export const comandoSchema = camposConfig.partial();

export type Leitura = z.infer<typeof leituraSchema> & { recebida_em: number };
export type Config = z.infer<typeof configSchema>;
export type Evento = { em: number; tipo: "info" | "alerta"; texto: string };
export type PontoHistorico = { t: number; nivel: number | null; bomba: boolean };

export const OFFLINE_APOS_MS = 15_000;
export const NIVEL_CRITICO = 10;
export const NIVEL_SEGURANCA = 98;
const HISTORICO_MAX = 300;
const EVENTOS_MAX = 50;

type Estado = {
  config: Config;
  ultima: Leitura | null;
  historico: PontoHistorico[];
  eventos: Evento[];
  avisouOffline: boolean;
};

const g = globalThis as unknown as { __estado?: Estado };
const estado: Estado = (g.__estado ??= {
  config: { modo: "auto", bomba_manual: "desligada", limite_min: 20, limite_max: 90 },
  ultima: null,
  historico: [],
  eventos: [],
  avisouOffline: false,
});

function registrarEvento(tipo: Evento["tipo"], texto: string) {
  estado.eventos.unshift({ em: Date.now(), tipo, texto });
  if (estado.eventos.length > EVENTOS_MAX) estado.eventos.pop();
}

export function registrarLeitura(dados: z.infer<typeof leituraSchema>): Config {
  const agora = Date.now();
  const anterior = estado.ultima;
  const l: Leitura = { ...dados, recebida_em: agora };

  if (!anterior || agora - anterior.recebida_em > OFFLINE_APOS_MS) {
    registrarEvento("info", "Dispositivo conectado");
  } else if (l.uptime_s < anterior.uptime_s) {
    registrarEvento("info", "Dispositivo reiniciou");
  }

  if (anterior) {
    if (l.bomba !== anterior.bomba) {
      const nivel = l.nivel === null ? "" : ` (nível ${l.nivel}%)`;
      registrarEvento("info", `Bomba ${l.bomba}${nivel}`);
    }
    if (!l.sensor_ok && anterior.sensor_ok) registrarEvento("alerta", "Falha no sensor: bomba desligada por segurança");
    if (l.sensor_ok && !anterior.sensor_ok) registrarEvento("info", "Sensor voltou a responder");
  }

  const nivelAntes = anterior?.nivel ?? null;
  if (l.nivel !== null) {
    if (l.nivel < NIVEL_CRITICO && (nivelAntes === null || nivelAntes >= NIVEL_CRITICO)) {
      registrarEvento("alerta", `Nível crítico: ${l.nivel}%`);
    }
    if (l.nivel >= NIVEL_SEGURANCA && (nivelAntes === null || nivelAntes < NIVEL_SEGURANCA)) {
      registrarEvento("alerta", `Nível em ${l.nivel}%: trava de segurança desliga a bomba`);
    }
  }

  estado.ultima = l;
  estado.avisouOffline = false;
  estado.historico.push({ t: agora, nivel: l.nivel, bomba: l.bomba === "ligada" });
  if (estado.historico.length > HISTORICO_MAX) estado.historico.shift();

  return estado.config;
}

export function alterarConfig(mudancas: z.infer<typeof comandoSchema>) {
  const resultado = configSchema.safeParse({ ...estado.config, ...mudancas });
  if (!resultado.success) return resultado;

  const antes = estado.config;
  const nova = resultado.data;
  estado.config = nova;

  if (nova.modo !== antes.modo) registrarEvento("info", `Painel: modo ${nova.modo === "auto" ? "automático" : "manual"}`);
  if (nova.bomba_manual !== antes.bomba_manual) registrarEvento("info", `Painel: bomba ${nova.bomba_manual} (manual)`);
  if (nova.limite_min !== antes.limite_min || nova.limite_max !== antes.limite_max) {
    registrarEvento("info", `Painel: limites ${nova.limite_min}% a ${nova.limite_max}%`);
  }
  return resultado;
}

export function obterEstado() {
  const agora = Date.now();
  const ultima = estado.ultima;
  const online = ultima !== null && agora - ultima.recebida_em <= OFFLINE_APOS_MS;

  if (ultima && !online && !estado.avisouOffline) {
    estado.avisouOffline = true;
    registrarEvento("alerta", "Dispositivo sem comunicação");
  }

  return {
    agora,
    online,
    segundos_desde_ultima: ultima ? Math.round((agora - ultima.recebida_em) / 1000) : null,
    ultima,
    config: estado.config,
    historico: estado.historico,
    eventos: estado.eventos,
  };
}

export type EstadoPainel = ReturnType<typeof obterEstado>;
