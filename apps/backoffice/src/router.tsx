// Seiten des Backoffice (M3). Pfade auf Deutsch, der Shop steht im Pfad (/<handle>/produkte).
import { createRootRoute, createRoute, createRouter, Navigate, Outlet } from "@tanstack/react-router";
import { AssistantPage } from "./pages/assistant.js";
import { CategoriesPage, EditCategoryPage, NewCategoryPage } from "./pages/categories.js";
import { DesignPage } from "./pages/design.js";
import { ForgotPasswordPage, ResetPasswordPage, SignInPage } from "./pages/auth.js";
import { AcceptInvitationPage } from "./pages/invitation.js";
import { HomeRedirect, ShopLayout } from "./pages/layout.js";
import { OrderPage, OrdersPage } from "./pages/orders.js";
import { OverviewPage } from "./pages/overview.js";
import { PlatformPage } from "./pages/platform.js";
import { EditProductPage, NewProductPage } from "./pages/product-editor.js";
import { ProductsPage } from "./pages/products.js";
import { CouponsPage } from "./pages/coupons.js";
import { CustomersPage } from "./pages/customers.js";
import { ShippingPage } from "./pages/shipping.js";
import { TeamPage } from "./pages/team.js";
import { parseOrderFilter } from "./lib/order-filter.js";
import { parseProductFilter } from "./lib/product-filter.js";

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

const invitation = createRoute({
  getParentRoute: () => root,
  path: "/einladung",
  component: AcceptInvitationPage,
});
// Plattform-Verwaltung (M8). Feste Pfade gehen vor /$shop; „plattform“ und „einladung“ sind deshalb
// als Kurznamen von Shops nicht nutzbar (reserviert im Modul platform).
const platform = createRoute({ getParentRoute: () => root, path: "/plattform", component: PlatformPage });

const shop = createRoute({ getParentRoute: () => root, path: "/$shop", component: ShopLayout });
const shopHome = createRoute({
  getParentRoute: () => shop,
  path: "/",
  component: function ShopHome() {
    const { shop: handle } = shop.useParams();
    return <Navigate to="/$shop/dashboard" params={{ shop: handle }} replace />;
  },
});
// Dashboard (Startseite des Shops; früher „Übersicht“ unter /uebersicht).
const overview = createRoute({ getParentRoute: () => shop, path: "/dashboard", component: OverviewPage });
const overviewOld = createRoute({
  getParentRoute: () => shop,
  path: "/uebersicht",
  component: function OldOverview() {
    const { shop: handle } = shop.useParams();
    return <Navigate to="/$shop/dashboard" params={{ shop: handle }} replace />;
  },
});

const products = createRoute({
  getParentRoute: () => shop,
  path: "/produkte",
  component: ProductsPage,
  validateSearch: parseProductFilter,
});
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

const categories = createRoute({
  getParentRoute: () => shop,
  path: "/kategorien",
  component: CategoriesPage,
});
const categoryNew = createRoute({
  getParentRoute: () => shop,
  path: "/kategorien/neu",
  component: NewCategoryPage,
});
const categoryEdit = createRoute({
  getParentRoute: () => shop,
  path: "/kategorien/$categoryId",
  component: EditCategoryPage,
});

// Shop-Editor (früher „Aussehen“ unter /aussehen).
const design = createRoute({ getParentRoute: () => shop, path: "/editor", component: DesignPage });
const designOld = createRoute({
  getParentRoute: () => shop,
  path: "/aussehen",
  component: function OldDesign() {
    const { shop: handle } = shop.useParams();
    return <Navigate to="/$shop/editor" params={{ shop: handle }} replace />;
  },
});

// KI-Assistent (Welle 2).
const assistant = createRoute({ getParentRoute: () => shop, path: "/assistent", component: AssistantPage });

// Team: Mitglieder sehen und einladen (nur Inhaber:in).
// Kundinnen und Kunden (aus Bestellungen).
const customers = createRoute({ getParentRoute: () => shop, path: "/kunden", component: CustomersPage });
// Gutscheincodes.
const coupons = createRoute({ getParentRoute: () => shop, path: "/gutscheine", component: CouponsPage });
// Versandkosten.
const shipping = createRoute({ getParentRoute: () => shop, path: "/versand", component: ShippingPage });
const team = createRoute({ getParentRoute: () => shop, path: "/team", component: TeamPage });

const orders = createRoute({
  getParentRoute: () => shop,
  path: "/bestellungen",
  component: OrdersPage,
  validateSearch: parseOrderFilter,
});
const order = createRoute({
  getParentRoute: () => shop,
  path: "/bestellungen/$orderId",
  component: OrderPage,
});

const routeTree = root.addChildren([
  home,
  signIn,
  forgot,
  reset,
  invitation,
  platform,
  shop.addChildren([
    shopHome,
    overview,
    overviewOld,
    products,
    productNew,
    productEdit,
    categories,
    categoryNew,
    categoryEdit,
    orders,
    order,
    design,
    designOld,
    assistant,
    team,
    shipping,
    coupons,
    customers,
  ]),
]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
