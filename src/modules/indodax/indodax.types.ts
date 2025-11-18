
export interface APIResponse {
  success: number;
  return?: any;
  error?: string;
}

export interface TickerResponse{
  buy: number;
  high: string;
  last: string;
  low: string;
  sell: string;
  server_time: number;
  vol_idr: string;
  vol_usdt: string;
}

export interface IIndodaxService {
    fetchTicker(symbol: string): Promise<Record<string, any>>
    privateCall(method: string, params: Record<string, string | number>): Promise<APIResponse>
}
