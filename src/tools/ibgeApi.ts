import axios from 'axios';
import { env } from '../config/env';

export type Indice = 'IPCA' | 'INPC';

export async function consultarIndice(indice: Indice, periodoInicio: string, periodoFim: string): Promise<unknown> {
  const agregado = indice === 'IPCA' ? env.ibgeIpcaAgregado : env.ibgeInpcAgregado;
  const url = `${env.ibgeBaseUrl}/${agregado}/periodos/${periodoInicio}|${periodoFim}/variaveis/63`;
  const { data } = await axios.get(url, {
    params: { localidades: 'N1[all]' },
    timeout: 15_000
  });
  return { indice, periodoInicio, periodoFim, dados: data, fonte: 'IBGE' };
}
