// Barra de progresso "falsa" — a chamada de IA é uma requisição só, sem
// eventos de progresso reais, então não existe um percentual de verdade pra
// mostrar (Patricia, 13/09/2026: "algo carregando" enquanto o rascunho
// gera). A barra sobe rápido no início e desacelera perto de ~92%, ficando
// ali até o fetcher de verdade terminar — nunca chega a 100% sozinha, pra
// não prometer um término que ainda não aconteceu. Reaproveitado em toda
// tela que gera conteúdo por IA (store voice, content pillars).
export function GeneratingProgressBar({ label }: { label: string }) {
  return (
    <div style={{ marginTop: 8, marginBottom: 8 }}>
      <style>{`
        @keyframes stockative-generating-fill {
          0% { width: 2%; }
          15% { width: 35%; }
          40% { width: 60%; }
          70% { width: 80%; }
          100% { width: 92%; }
        }
      `}</style>
      <div style={{ fontSize: 13, color: "#6d7175", marginBottom: 6 }}>{label}</div>
      <div
        style={{
          width: "100%",
          height: 8,
          borderRadius: 4,
          background: "#e3e5e7",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            borderRadius: 4,
            background: "#008060",
            animation: "stockative-generating-fill 16s cubic-bezier(0.15, 0.65, 0.25, 1) forwards",
          }}
        />
      </div>
    </div>
  );
}
