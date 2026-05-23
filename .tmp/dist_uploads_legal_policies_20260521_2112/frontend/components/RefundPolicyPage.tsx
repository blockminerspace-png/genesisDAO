import React from 'react';
import { ReceiptText } from 'lucide-react';
import { LegalPageLayout, type LegalSection } from './LegalPageLayout';

const sections: LegalSection[] = [
  {
    id: 'escopo',
    title: '1. Escopo',
    body: [
      'Esta política descreve como o Genesis Miner trata pedidos de reembolso relacionados com compras, créditos, itens digitais, depósitos e serviços internos, sempre sujeitos à legislação obrigatória aplicável.'
    ]
  },
  {
    id: 'itens-digitais',
    title: '2. Itens digitais e entregas consumadas',
    body: [
      'Compras de itens digitais, benefícios internos, entregas instantâneas, moedas ou vantagens operacionais podem ser consideradas consumadas assim que creditadas, ativadas, utilizadas ou disponibilizadas na conta.',
      'Nesses casos, pedidos de reembolso podem ser recusados quando permitido por lei.'
    ]
  },
  {
    id: 'depositos',
    title: '3. Depósitos e operações blockchain',
    body: [
      'Depósitos on-chain, transferências blockchain e operações externas geralmente não podem ser revertidos pelo Genesis Miner.',
      'Taxas de rede, erros de envio, rede errada, token errado ou carteira incorreta não geram obrigação automática de reembolso pela plataforma.'
    ]
  },
  {
    id: 'fraude-abuso',
    title: '4. Fraude, chargeback e abuso',
    body: [
      'Pedidos ligados a fraude, chargeback abusivo, uso indevido, exploração de falhas, múltiplas contas, manipulação de saldo ou violação dos Termos podem ser recusados e podem levar a restrições adicionais na conta.'
    ]
  },
  {
    id: 'analise',
    title: '5. Análise de pedidos',
    body: [
      'Cada pedido poderá ser analisado segundo histórico da conta, estado do bem ou serviço digital, uso já ocorrido, risco operacional, conformidade e direitos legais obrigatórios do consumidor.'
    ]
  },
  {
    id: 'contacto',
    title: '6. Como pedir análise',
    body: [
      'Para solicitar análise de reembolso, use os canais oficiais de suporte com o máximo de detalhe possível sobre a operação, a conta, a data e o motivo do pedido.'
    ]
  }
];

export const RefundPolicyPage: React.FC = () => {
  return (
    <LegalPageLayout
      title="Política de Reembolsos"
      intro="Esta política resume como o Genesis Miner trata pedidos de reembolso, estorno e revisão de compras ou operações."
      updatedAt="21 de maio de 2026"
      accentClass="text-cyan-700 dark:text-cyan-400"
      accentHoverClass="hover:text-cyan-600 dark:hover:text-cyan-300"
      iconClass="text-cyan-600 dark:text-cyan-500"
      icon={ReceiptText}
      sections={sections}
    />
  );
};
