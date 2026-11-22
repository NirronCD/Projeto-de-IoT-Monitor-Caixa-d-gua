"use client";

import { useEffect, useState } from "react";
import type { Config, EstadoPainel, PontoHistorico } from "@/lib/estado";

const NIVEL_CRITICO = 10;
const NIVEL_SEGURANCA = 98;
const JANELA_GRAFICO_MS = 10 * 60 * 1000;

export default function Painel() {
  const [estado, setEstado] = useState<EstadoPainel | null>(null);
  const [erroServidor, setErroServidor] = useState(false);

  useEffect(() => {
    let ativo = true;
    async function atualizar() {
      try {
        const r = await fetch(`${location.origin}/api/estado`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const dados = (await r.json()) as EstadoPainel;
        if (ativo) { setEstado(dados); setErroServidor(false); }
      } catch {
        if (ativo) setErroServidor(true);
      }
    }
    atualizar();
    const id = setInterval(atualizar, 2000);
    return () => { ativo = false; clearInterval(id); };
  }, []);

  async function enviarComando(mudancas: Partial<Config>): Promise<string | null> {
    try {
      const r = await fetch(`${location.origin}/api/comando`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mudancas),
      });
      const dados = await r.json();
      if (!r.ok) return dados.erro ?? "Comando recusado";
      setEstado((e) => (e ? { ...e, config: dados.config } : e));
      return null;
    } catch {
      return "Sem conexão com o servidor";
    }
  }

  if (!estado) {
    return <main className="carregando">{erroServidor ? "Sem conexão com o servidor" : "Carregando…"}</main>;
  }

  const { ultima, config, online } = estado;
  const nivel = ultima?.sensor_ok ? ultima.nivel : null;

  const alertas: string[] = [];
  if (erroServidor) alertas.push("Sem conexão com o servidor. Os dados podem estar desatualizados.");
  if (!ultima) alertas.push("Nenhuma leitura recebida ainda. Ligue o ESP32.");
  else if (!online) alertas.push(`Dispositivo sem comunicação há ${estado.segundos_desde_ultima} s. O controle local continua no ESP32.`);
  if (ultima && !ultima.sensor_ok) alertas.push("Falha no sensor: a bomba foi desligada por segurança.");
  if (nivel !== null && nivel < NIVEL_CRITICO) alertas.push(`Nível crítico: ${nivel}%. A caixa está quase vazia.`);
  if (nivel !== null && nivel >= NIVEL_SEGURANCA) alertas.push(`Nível em ${nivel}%: a trava de segurança mantém a bomba desligada.`);

  return (
    <main>
      <header className="topo">
        <div>
          <h1>Caixa d&apos;Água</h1>
          <p className="sub">Monitor inteligente · ESP32</p>
        </div>
        <StatusConexao estado={estado} />
      </header>

      {alertas.length > 0 && (
        <div className="alertas" role="alert">
          {alertas.map((a) => <p key={a}>{a}</p>)}
        </div>
      )}

      <div className="grade">
        <section className="cartao cartao-caixa">
          <h2>Nível</h2>
          <Caixa nivel={nivel} config={config} sensorOk={ultima?.sensor_ok ?? true} />
        </section>

        <section className="cartao">
          <h2>Bomba</h2>
          <Bomba estado={estado} enviar={enviarComando} />
        </section>

        <section className="cartao">
          <h2>Limites do modo automático</h2>
          <Limites config={config} enviar={enviarComando} />
        </section>

        <section className="cartao cartao-largo">
          <h2>Histórico (últimos 10 min)</h2>
          <Grafico historico={estado.historico} agora={estado.agora} config={config} />
        </section>

        <section className="cartao cartao-largo">
          <h2>Eventos e alertas</h2>
          <Eventos estado={estado} />
        </section>

        <section className="cartao">
          <h2>Dispositivo</h2>
          <Dispositivo estado={estado} />
        </section>
      </div>
    </main>
  );
}

function StatusConexao({ estado }: { estado: EstadoPainel }) {
  const { online, segundos_desde_ultima: s } = estado;
  const texto = s === null ? "Aguardando" : online ? "Online" : "Offline";
  return (
    <div className={`status ${online ? "on" : "off"}`}>
      <span className="ponto" />
      <span>{texto}</span>
      {s !== null && <span className="detalhe">última leitura há {s} s</span>}
    </div>
  );
}

function corDoNivel(nivel: number | null, config: Config) {
  if (nivel === null) return "azul";
  if (nivel < config.limite_min) return "vermelho";
  if (nivel < config.limite_max) return "amarelo";
  return "verde";
}

function Caixa({ nivel, config, sensorOk }: { nivel: number | null; config: Config; sensorOk: boolean }) {
  const cor = corDoNivel(nivel, config);
  return (
    <div className="caixa-wrap">
      <div className={`caixa ${cor}`}>
        <div className="agua" style={{ height: `${nivel ?? 0}%` }} />
        <div className="marca" style={{ bottom: `${config.limite_max}%` }}><span>{config.limite_max}%</span></div>
        <div className="marca" style={{ bottom: `${config.limite_min}%` }}><span>{config.limite_min}%</span></div>
      </div>
      <div className="nivel-texto">
        <strong className={cor}>{nivel === null ? "--" : `${nivel}%`}</strong>
        <span>{!sensorOk ? "Sensor com falha" : nivel === null ? "Sem leitura" : textoNivel(nivel, config)}</span>
      </div>
    </div>
  );
}

function textoNivel(nivel: number, config: Config) {
  if (nivel < NIVEL_CRITICO) return "Crítico";
  if (nivel < config.limite_min) return "Baixo";
  if (nivel < config.limite_max) return "Normal";
  return "Cheia";
}

function Bomba({ estado, enviar }: { estado: EstadoPainel; enviar: (m: Partial<Config>) => Promise<string | null> }) {
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const { ultima, config } = estado;
  const ligada = ultima?.bomba === "ligada";

  async function mandar(m: Partial<Config>) {
    setEnviando(true);
    setErro(await enviar(m));
    setEnviando(false);
  }

  const sincronizado = !ultima || (ultima.modo === config.modo &&
    ultima.limite_min === config.limite_min && ultima.limite_max === config.limite_max);

  return (
    <div className="bomba">
      <div className={`bomba-estado ${ligada ? "ligada" : ""}`}>
        <span className="bomba-icone" aria-hidden>{ligada ? "●" : "○"}</span>
        {ultima ? (ligada ? "Ligada" : "Desligada") : "--"}
      </div>

      <div className="rotulo">Modo</div>
      <div className="segmentos">
        <button className={config.modo === "auto" ? "ativo" : ""} disabled={enviando}
          onClick={() => mandar({ modo: "auto" })}>Automático</button>
        <button className={config.modo === "manual" ? "ativo" : ""} disabled={enviando}
          onClick={() => mandar({ modo: "manual" })}>Manual</button>
      </div>

      {config.modo === "manual" ? (
        <>
          <div className="rotulo">Comando manual</div>
          <div className="segmentos">
            <button className={config.bomba_manual === "ligada" ? "ativo" : ""} disabled={enviando}
              onClick={() => mandar({ bomba_manual: "ligada" })}>Ligar</button>
            <button className={config.bomba_manual === "desligada" ? "ativo" : ""} disabled={enviando}
              onClick={() => mandar({ bomba_manual: "desligada" })}>Desligar</button>
          </div>
          <p className="dica">Mesmo no manual, a bomba desliga sozinha a partir de {NIVEL_SEGURANCA}%.</p>
        </>
      ) : (
        <p className="dica">Liga abaixo de {config.limite_min}% e desliga ao chegar em {config.limite_max}%.</p>
      )}

      {!sincronizado && <p className="dica pendente">Aguardando o dispositivo aplicar…</p>}
      {erro && <p className="erro">{erro}</p>}
    </div>
  );
}

function Limites({ config, enviar }: { config: Config; enviar: (m: Partial<Config>) => Promise<string | null> }) {
  const [rascunho, setRascunho] = useState<{ min: string; max: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const min = rascunho?.min ?? String(config.limite_min);
  const max = rascunho?.max ?? String(config.limite_max);
  const nMin = Number(min);
  const nMax = Number(max);

  let invalido: string | null = null;
  if (!Number.isInteger(nMin) || nMin < 5 || nMin > 80) invalido = "Mínimo deve ser um inteiro de 5 a 80.";
  else if (!Number.isInteger(nMax) || nMax < 20 || nMax > 95) invalido = "Máximo deve ser um inteiro de 20 a 95.";
  else if (nMax - nMin < 10) invalido = "O máximo precisa ser pelo menos 10 pontos maior que o mínimo.";

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (invalido) return;
    const falha = await enviar({ limite_min: nMin, limite_max: nMax });
    setErro(falha);
    if (!falha) { setRascunho(null); setOk(true); setTimeout(() => setOk(false), 2000); }
  }

  return (
    <form className="limites" onSubmit={salvar}>
      <label>
        Liga abaixo de (%)
        <input type="number" min={5} max={80} value={min}
          onChange={(e) => setRascunho({ min: e.target.value, max })} />
      </label>
      <label>
        Desliga em (%)
        <input type="number" min={20} max={95} value={max}
          onChange={(e) => setRascunho({ min, max: e.target.value })} />
      </label>
      {rascunho && invalido && <p className="erro">{invalido}</p>}
      {erro && <p className="erro">{erro}</p>}
      <div className="acoes">
        <button type="submit" className="primario" disabled={!rascunho || !!invalido}>Salvar</button>
        {rascunho && <button type="button" onClick={() => { setRascunho(null); setErro(null); }}>Cancelar</button>}
        {ok && <span className="dica">Salvo</span>}
      </div>
    </form>
  );
}

function Grafico({ historico, agora, config }: { historico: PontoHistorico[]; agora: number; config: Config }) {
  const L = 600, A = 200;
  const inicio = agora - JANELA_GRAFICO_MS;
  const x = (t: number) => ((t - inicio) / JANELA_GRAFICO_MS) * L;
  const y = (n: number) => A - (n / 100) * A;
  const pontos = historico.filter((p) => p.t >= inicio);

  const trechos: string[] = [];
  let atual: string[] = [];
  for (const p of pontos) {
    if (p.nivel === null) { if (atual.length) trechos.push(atual.join(" ")); atual = []; }
    else atual.push(`${x(p.t).toFixed(1)},${y(p.nivel).toFixed(1)}`);
  }
  if (atual.length) trechos.push(atual.join(" "));

  const faixas: { x1: number; x2: number }[] = [];
  for (let i = 0; i < pontos.length; i++) {
    if (!pontos[i].bomba) continue;
    const fim = pontos[i + 1]?.t ?? pontos[i].t;
    const ultima = faixas[faixas.length - 1];
    if (ultima && Math.abs(ultima.x2 - x(pontos[i].t)) < 0.01) ultima.x2 = x(fim);
    else faixas.push({ x1: x(pontos[i].t), x2: x(fim) });
  }

  if (pontos.length === 0) return <p className="vazio">Sem leituras nos últimos 10 minutos.</p>;

  return (
    <div className="grafico">
      <div className="eixo-y"><span>100%</span><span>50%</span><span>0%</span></div>
      <div className="grafico-area">
        <svg viewBox={`0 0 ${L} ${A}`} preserveAspectRatio="none" role="img" aria-label="Nível da caixa ao longo do tempo">
          {faixas.map((f, i) => (
            <rect key={i} x={f.x1} y={0} width={Math.max(f.x2 - f.x1, 1)} height={A} className="faixa-bomba" />
          ))}
          {[25, 50, 75].map((n) => <line key={n} x1={0} x2={L} y1={y(n)} y2={y(n)} className="grade-linha" />)}
          <line x1={0} x2={L} y1={y(config.limite_max)} y2={y(config.limite_max)} className="limite" />
          <line x1={0} x2={L} y1={y(config.limite_min)} y2={y(config.limite_min)} className="limite" />
          {trechos.map((t, i) => <polyline key={i} points={t} className="linha-nivel" />)}
        </svg>
        <div className="eixo-x"><span>-10 min</span><span>-5 min</span><span>agora</span></div>
      </div>
      <div className="legenda">
        <span><i className="leg-linha" /> nível</span>
        <span><i className="leg-limite" /> limites ({config.limite_min}% / {config.limite_max}%)</span>
        <span><i className="leg-bomba" /> bomba ligada</span>
      </div>
    </div>
  );
}

function Eventos({ estado }: { estado: EstadoPainel }) {
  if (estado.eventos.length === 0) return <p className="vazio">Nenhum evento ainda.</p>;
  return (
    <ul className="eventos">
      {estado.eventos.map((e) => (
        <li key={`${e.em}-${e.texto}`} className={e.tipo}>
          <time>{new Date(e.em).toLocaleTimeString("pt-BR")}</time>
          <span>{e.texto}</span>
        </li>
      ))}
    </ul>
  );
}

function Dispositivo({ estado }: { estado: EstadoPainel }) {
  const u = estado.ultima;
  if (!u) return <p className="vazio">Aguardando a primeira leitura.</p>;
  const linhas: [string, string][] = [
    ["Distância medida", u.distancia_cm === null ? "--" : `${u.distancia_cm.toFixed(1)} cm`],
    ["Sensor", u.sensor_ok ? "OK" : "Falha"],
    ["Modo em uso", u.modo === "auto" ? "Automático" : "Manual"],
    ["Limites em uso", `${u.limite_min}% / ${u.limite_max}%`],
    ["Sinal Wi-Fi", `${u.rssi} dBm`],
    ["Ligado há", formatarDuracao(u.uptime_s)],
  ];
  return (
    <dl className="dados">
      {linhas.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
    </dl>
  );
}

function formatarDuracao(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), seg = s % 60;
  return h > 0 ? `${h} h ${m} min` : m > 0 ? `${m} min ${seg} s` : `${seg} s`;
}
