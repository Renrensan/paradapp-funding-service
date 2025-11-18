import { injectable, inject } from "tsyringe";
import axios from "axios";
import * as crypto from "crypto";
import * as qs from "qs";
import { INDODAX_TOKENS } from "./tokens";
import { APIResponse, TickerResponse } from "./indodax.types";

@injectable()
export class IndodaxService {
  private readonly baseUrl = "https://indodax.com/tapi/";

  constructor(
    @inject(INDODAX_TOKENS.INDODAX_API_KEY) private key: string,
    @inject(INDODAX_TOKENS.INDODAX_SECRET) private secret: string
  ) {}

  public async fetchTicker(symbol: string): Promise<TickerResponse> {
    const url = `https://indodax.com/api/ticker/${encodeURIComponent(symbol)}`;
    try {
      const response = await axios.get<Record<string, any>>(url);

      if (!response.data || typeof response.data.ticker !== "object") {
        throw new Error("Invalid ticker data received from Indodax API");
      }

      return response.data.ticker as TickerResponse;
    } catch (err: any) {
      throw new Error(`Failed to fetch ticker for ${symbol}: ${err?.message || err}`);
    }
  }


  public async privateCall(method: string, params: Record<string, string | number> = {}): Promise<APIResponse> {
    const nonce = Date.now().toString();
    params.method = method;
    params.nonce = nonce;

    const sortedKeys = Object.keys(params).sort();
    const payloadObj: Record<string, string> = {};
    for (const key of sortedKeys) {
      payloadObj[key] = params[key].toString();
    }

    const payloadStr = qs.stringify(payloadObj);

    const sign = crypto.createHmac("sha512", this.secret)
      .update(payloadStr)
      .digest("hex");

    try {
      const response = await axios.post<APIResponse>(
        this.baseUrl,
        payloadStr,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Key": this.key,
            "Sign": sign,
          },
        }
      );

      const apiResp = response.data;

      if (apiResp.success !== 1) {
        throw new Error(`Indodax error: ${apiResp.error}`);
      }

      return apiResp;
    } catch (err) {
      throw err;
    }
  }
}
