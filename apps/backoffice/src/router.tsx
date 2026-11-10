// Seiten des Backoffice (M3). Pfade auf Deutsch, der Shop steht im Pfad (/<handle>/produkte).
import { createRootRoute, createRoute, createRouter, Navigate, Outlet } from "@tanstack/react-router";
import { ForgotPasswordPage, ResetPasswordPage, SignInPage } from "./pages/auth.js";
import { HomeRedirect, ShopLayout } from "./pages/layout.js";
import { EditProductPage, NewProductPage } from "./pages/product-editor.js";
import { ProductsPage } from "./pages/products.js";

const root = createRootRoute({
  component: Outlet,
  notFoundComponent: () => <Navigate to="/" replace />,
});

const home = createRoute({ getParentRoute: () => root, path: "/", component: HomeRedirect });
const signIn = createRoute({ getParentRoute: () => root, path: "/anmelden", component: SignInPage });
const forgot = createRoute({
  getParentRoute: () => root,
  path: "/passwort-vergessen",
  component: ForgotPasswordPage,
});
const reset = createRoute({
  getParentRoute: () => root,
  path: "/passwort-neu",
  component: ResetPasswordPage,
});

const shop = createRoute({ getParentRoute: () => root, path: "/$shop", component: ShopLayout });
const shopHome = createRoute({
  getParentRoute: () => shop,
  path: "/",
  component: function ShopHome() {
    const { shop: handle } = shop.useParams();
    return <Navigate to="/$shop/produkte" params={{ shop: handle }} replace />;
  },
});
const products = createRoute({ getParentRoute: () => shop, path: "/produkte", component: ProductsPage });
const productNew = createRoute({
  getParentRoute: () => shop,
  path: "/produkte/neu",
  component: NewProductPage,
});
const productEdit = createRoute({
  getParentRoute: () => shop,
  path: "/produkte/$productId",
  component: EditProductPage,
});

const routeTree = root.addChildren([
  home,
  signIn,
  forgot,
  reset,
  shop.addChildren([shopHome, products, productNew, productEdit]),
]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
