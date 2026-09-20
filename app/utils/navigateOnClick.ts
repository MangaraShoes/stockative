// s-button/s-link com href= fazem uma navegação de documento inteira (um <a>
// de verdade) — dentro do iframe do app embutido no Shopify Admin isso perde
// host/shop/embedded da URL atual, que a autenticação do Shopify exige em
// toda requisição; a re-autenticação resultante fica bloqueada pelo próprio
// iframe (achado ao vivo, 20/09/2026: clique em "View weekly plan" não
// abria nada, com s-button E s-link). Use isto pra interceptar o clique e
// navegar pelo React Router (fetch de dados, não document load), que já
// carrega o token via o fetch global que o App Bridge intercepta.
export function goTo(navigate: (href: string) => void, href: string) {
  return (event: { preventDefault: () => void }) => {
    event.preventDefault();
    navigate(href);
  };
}
