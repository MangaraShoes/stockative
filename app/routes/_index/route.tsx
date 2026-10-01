import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  // Dentro do admin da Shopify, nunca mostrar esta página (Patricia,
  // 01/10/2026: clicar no nome "Stockative" no topo do app embutido navega
  // pra "/" sem o parâmetro shop e caía na página de exemplo do template).
  // Navegação interna (fetch, Sec-Fetch-Dest "empty") ou carregamento dentro
  // do iframe ("iframe") vão pro app; só uma visita direta no navegador
  // ("document", ou sem o header) mostra a página pública abaixo.
  const fetchDest = request.headers.get("Sec-Fetch-Dest");
  if (fetchDest === "empty" || fetchDest === "iframe") {
    throw redirect(`/app${url.search}`);
  }

  return { showForm: Boolean(login) };
};

// Página pública de app.stockative.com — é o "Site URL" cadastrado no Meta
// App Review, então é o que o revisor vê se abrir o link direto. Antes era o
// texto de exemplo do template da Shopify ("A short heading about [your app]").
export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Stockative</h1>
        <p className={styles.text}>
          Your Shopify store knows what needs to sell. We turn it into content.
        </p>
        <p className={styles.text}>
          Stockative is a Shopify app: it reads your products, stock and sales,
          decides what to promote each week, writes the captions, creates the
          product images and publishes to your connected Instagram, Facebook
          and other social accounts. It runs inside your Shopify admin.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Open Stockative for your store</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g. my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Decides what to promote</strong>. Weekly plan built from
            your real inventory, sales velocity and commercial calendar.
          </li>
          <li>
            <strong>Creates the content</strong>. Captions in your brand voice
            and AI product images that stay faithful to your product.
          </li>
          <li>
            <strong>Publishes for you</strong>. Posts go out at their scheduled
            time; you can review, swap, reschedule or cancel any of them first.
          </li>
        </ul>
        <p>
          <a href="https://stockative.com">stockative.com</a> ·{" "}
          <a href="https://stockative.com/#privacy">Privacy Policy</a> ·{" "}
          <a href="https://stockative.com/#terms">Terms of Service</a>
        </p>
      </div>
    </div>
  );
}
