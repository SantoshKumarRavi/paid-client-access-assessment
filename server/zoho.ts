export type ZohoConfig = {
  ZOHO_ACCOUNTS_URL: string;
  ZOHO_API_URL: string;
  ZOHO_CLIENT_ID?: string;
  ZOHO_CLIENT_SECRET?: string;
  ZOHO_REFRESH_TOKEN?: string;
  ZOHO_ACCESS_TOKEN?: string;
  ZOHO_PAID_STAGE: string;
};
export class ZohoClient {
  private cached?: { token: string; until: number };
  private refreshing?: Promise<string>;
  constructor(
    private cfg: ZohoConfig,
    private http: typeof fetch = fetch,
  ) {}
  async token(): Promise<string> {
    if (this.cached && this.cached.until > Date.now()) return this.cached.token;
    if (this.refreshing) return this.refreshing;
    if (!this.cfg.ZOHO_REFRESH_TOKEN) {
      if (this.cfg.ZOHO_ACCESS_TOKEN) return this.cfg.ZOHO_ACCESS_TOKEN;
      throw Error("CRM credentials are not configured");
    }
    this.refreshing = (async () => {
      const response = await this.http(
        `${this.cfg.ZOHO_ACCOUNTS_URL}/oauth/v2/token`,
        {
          method: "POST",
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: this.cfg.ZOHO_REFRESH_TOKEN!,
            client_id: this.cfg.ZOHO_CLIENT_ID || "",
            client_secret: this.cfg.ZOHO_CLIENT_SECRET || "",
          }),
          signal: AbortSignal.timeout(10000),
        },
      );
      const body = await response.json();
      if (!response.ok || !body.access_token)
        throw Error("CRM OAuth refresh failed");
      this.cached = {
        token: body.access_token,
        until: Date.now() + (Number(body.expires_in || 3600) - 120) * 1000,
      };
      return body.access_token as string;
    })();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = undefined;
    }
  }
  async request(path: string, init: RequestInit = {}): Promise<any> {
    const response = await this.http(
      `${this.cfg.ZOHO_API_URL}/crm/v8/${path}`,
      {
        ...init,
        headers: {
          Authorization: `Zoho-oauthtoken ${await this.token()}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (response.status === 401) this.cached = undefined;
    if (!response.ok) throw Error(`CRM HTTP ${response.status}`);
    if (response.status === 204) return { data: [] };
    const data = await response.json();
    if (data.data?.some((r: any) => r.status === "error"))
      throw Error(
        `CRM record rejected: ${data.data.find((r: any) => r.status === "error").code}`,
      );
    return data;
  }
  async markPaid(job: {
    purchase_id: string;
    zoho_deal_id: string;
    stripe_session_id: string;
  }) {
    const { data } = await this.request(
      `Deals/${job.zoho_deal_id}?fields=Description,Stage,Modified_Time`,
    );
    const deal = data?.[0];
    if (!deal) throw Error("CRM deal not found");
    const marker = `[PAC_PAID:${job.purchase_id}]`;
    // Reconcile an ambiguous earlier success before any new write.
    if (
      (deal.Description || "").includes(marker) &&
      deal.Stage === this.cfg.ZOHO_PAID_STAGE
    )
      return;
    const description =
      `${deal.Description || ""}\n${marker} Stripe test purchase ${job.stripe_session_id}`.trim();
    if (description.length > 30000)
      throw Error("CRM description too long; needs operator review");
    if (!deal.Modified_Time) throw Error("CRM concurrency version unavailable");
    const result = await this.request(`Deals/${job.zoho_deal_id}`, {
      method: "PUT",
      headers: { "If-Unmodified-Since": deal.Modified_Time },
      body: JSON.stringify({
        data: [
          {
            id: job.zoho_deal_id,
            Stage: this.cfg.ZOHO_PAID_STAGE,
            Description: description,
          },
        ],
        trigger: [],
        skip_feature_execution: [{ name: "cadences" }],
      }),
    });
    if (result.data?.[0]?.code !== "SUCCESS")
      throw Error("CRM did not confirm update");
  }
}
