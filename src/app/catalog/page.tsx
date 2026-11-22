import Link from "next/link";
import { Search } from "lucide-react";
import { PassportShell } from "@/components/app-shell";
import { EmptyState, ProductCard } from "@/components/ui";
import { getDatabase } from "@/lib/database";
import { syncChain } from "@/lib/chain-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Product catalog" };

export default async function Catalog({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; page?: string | string[] }>;
}) {
  const params = await searchParams;
  const query =
    typeof params.q === "string" ? params.q.trim().slice(0, 120) : "";
  const requestedPage = Number(params.page);
  const db = getDatabase();
  await syncChain(db);
  const { products, page, pages, total } = db.catalog(
    query,
    Number.isSafeInteger(requestedPage) ? requestedPage : 1,
  );
  const pageHref = (number: number) =>
    "/catalog?" + new URLSearchParams({ q: query, page: String(number) });

  return (
    <PassportShell>
      <header className="page-heading">
        <div>
          <h1>Product catalog</h1>
          <p>Browse registered products and open their public passports.</p>
        </div>
      </header>
      <form
        className="search-form catalog-search"
        action="/catalog"
        method="get"
      >
        <div>
          <Search size={18} aria-hidden="true" />
          <input
            name="q"
            aria-label="Search by model, brand or serial number"
            placeholder="Search model, brand or serial number"
            maxLength={120}
            defaultValue={query}
          />
        </div>
        <button className="button">Search</button>
      </form>
      <div className="section-row">
        <p>
          {total} {total === 1 ? "product" : "products"}
          {query && <> matching “{query}”</>}
        </p>
        {query && (
          <Link className="text-link" href="/catalog">
            Clear search
          </Link>
        )}
      </div>
      {products.length ? (
        <div className="product-grid">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              href={`/verify?q=${encodeURIComponent(product.serial_number)}`}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title={query ? "No matching products" : "No registered products yet"}
          description={
            query
              ? "Try a different model, brand or serial number."
              : "Products appear here after registration."
          }
        />
      )}
      {pages > 1 && (
        <nav className="catalog-pagination" aria-label="Catalog pages">
          {page > 1 && (
            <Link className="text-link" href={pageHref(page - 1)}>
              Previous
            </Link>
          )}
          <span>
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link className="text-link" href={pageHref(page + 1)}>
              Next
            </Link>
          )}
        </nav>
      )}
    </PassportShell>
  );
}
