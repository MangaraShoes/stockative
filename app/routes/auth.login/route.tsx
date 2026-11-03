import { AppProvider } from "@shopify/shopify-app-react-router/react";
import type { LoaderFunctionArgs } from "react-router";

import { login } from "../../shopify.server";

// Sem campo de domínio da loja (03/11/2026, requisito 2.3.1 da App Store: a
// lojista nunca digita o myshopify.com). login() continua no loader porque
// é ele que redireciona pra instalação quando a Shopify manda ?shop= sozinha;
// sem esse parâmetro, esta página só explica por onde abrir o app.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await login(request);
  return null;
};

export default function Auth() {
  return (
    <AppProvider embedded={false}>
      <s-page>
        <s-section heading="Open Stockative from Shopify">
          <s-paragraph>
            Install Stockative from the Shopify App Store, or open it from the
            Apps section of your Shopify admin.
          </s-paragraph>
        </s-section>
      </s-page>
    </AppProvider>
  );
}
