// Test-only PostgREST boundary backed by actual PostgreSQL, never a cloud endpoint.
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
const identifier = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name))
    throw new Error(`Unsupported test identifier: ${name}`);
  return `"${name}"`;
};
const parameter = (value: unknown) =>
  value !== null && typeof value === "object" ? JSON.stringify(value) : value;
export function pgliteClient(pg: PGlite) {
  let writes = 0;
  function from(table: string) {
    const conditions: string[] = [],
      values: unknown[] = [],
      orders: string[] = [];
    let columns = "*",
      limit: number | undefined,
      offset = 0,
      one = false;
    let operation = "select",
      body: Record<string, unknown> = {},
      conflict = "";
    const bind = (value: unknown) => {
      values.push(parameter(value));
      return `$${values.length}`;
    };
    const query = {
      select(fields = "*") {
        columns =
          fields === "*" ? "*" : fields.split(",").map(identifier).join(",");
        return query;
      },
      eq(field: string, value: unknown) {
        conditions.push(`${identifier(field)}=${bind(value)}`);
        return query;
      },
      is(field: string, value: unknown) {
        if (value !== null) throw new Error("Unsupported test IS");
        conditions.push(`${identifier(field)} is null`);
        return query;
      },
      in(field: string, list: unknown[]) {
        conditions.push(
          list.length
            ? `${identifier(field)} in (${list.map(bind).join(",")})`
            : "false",
        );
        return query;
      },
      match(fields: Record<string, unknown>) {
        for (const [key, value] of Object.entries(fields)) query.eq(key, value);
        return query;
      },
      order(field: string, options?: { ascending?: boolean }) {
        orders.push(
          `${identifier(field)} ${options?.ascending === false ? "desc" : "asc"}`,
        );
        return query;
      },
      range(start: number, end: number) {
        offset = start;
        limit = end - start + 1;
        return query;
      },
      limit(count: number) {
        limit = count;
        return query;
      },
      maybeSingle() {
        one = true;
        return query;
      },
      insert(data: Record<string, unknown>) {
        operation = "insert";
        body = data;
        return query;
      },
      upsert(
        data: Record<string, unknown>,
        options: { onConflict: string; ignoreDuplicates?: boolean },
      ) {
        operation = "insert";
        body = data;
        conflict = ` on conflict (${options.onConflict.split(",").map(identifier).join(",")}) ${
          options.ignoreDuplicates
            ? "do nothing"
            : `do update set ${Object.keys(data)
                .map((key) => `${identifier(key)}=excluded.${identifier(key)}`)
                .join(",")}`
        }`;
        return query;
      },
      update(data: Record<string, unknown>) {
        operation = "update";
        body = data;
        return query;
      },
      async then(
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
      ) {
        try {
          const where = conditions.length
            ? ` where ${conditions.join(" and ")}`
            : "";
          let sql;
          if (operation === "insert") {
            writes++;
            sql = `insert into public.${identifier(table)} (${Object.keys(body).map(identifier).join(",")}) values (${Object.values(body).map(bind).join(",")})${conflict} returning ${columns}`;
          } else if (operation === "update") {
            writes++;
            sql = `update public.${identifier(table)} set ${Object.entries(body)
              .map(([key, value]) => `${identifier(key)}=${bind(value)}`)
              .join(",")}${where} returning ${columns}`;
          } else
            sql = `select ${columns} from public.${identifier(table)}${where}${orders.length ? ` order by ${orders.join(",")}` : ""}${limit !== undefined ? ` limit ${limit} offset ${offset}` : ""}`;
          const result = await pg.query(sql, values);
          return resolve({
            data: one ? result.rows[0] || null : result.rows,
            error: null,
          });
        } catch (error) {
          return resolve({ data: null, error });
        }
      },
    };
    return query;
  }
  const client = {
    from,
    async rpc(name: string, parameters: Record<string, unknown>) {
      try {
        writes++;
        const values = Object.values(parameters).map(parameter);
        const argumentsSql = Object.keys(parameters)
          .map(
            (key, index) =>
              `${identifier(key)}=>$${index + 1}${key === "p_events" ? "::jsonb" : ""}`,
          )
          .join(",");
        const result = await pg.query<{ result: unknown }>(
          `select public.${identifier(name)}(${argumentsSql}) as result`,
          values,
        );
        return { data: result.rows[0].result, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  };
  return {
    client: client as unknown as SupabaseClient,
    get writes() {
      return writes;
    },
  };
}
