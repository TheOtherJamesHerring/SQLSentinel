import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useApiQuery<T>(
  key: string[],
  path: string,
  options?: { refetchInterval?: number; enabled?: boolean }
) {
  return useQuery({
    queryKey: key,
    queryFn: () => api<T>(path),
    refetchInterval: options?.refetchInterval,
    enabled: options?.enabled
  });
}
