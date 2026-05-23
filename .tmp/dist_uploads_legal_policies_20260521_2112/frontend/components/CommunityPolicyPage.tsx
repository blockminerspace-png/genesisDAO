import React from 'react';
import { MessagesSquare } from 'lucide-react';
import { LegalPageLayout, type LegalSection } from './LegalPageLayout';

const sections: LegalSection[] = [
  {
    id: 'objetivo',
    title: '1. Objetivo',
    body: [
      'Esta política define padrões mínimos de convivência, conduta, conteúdo e uso aceitável em áreas sociais, suporte, comunicação e interações dentro do ecossistema Genesis Miner.'
    ]
  },
  {
    id: 'conteudo-proibido',
    title: '2. Conteúdo proibido',
    body: [
      'É proibido publicar ou transmitir conteúdo ilegal, ameaçador, difamatório, violento, discriminatório, obsceno, enganoso, fraudulento, malicioso ou que coloque terceiros em risco.',
      'Também é proibido conteúdo sexual envolvendo menores, incentivo à violência, discurso de ódio, perseguição, assédio ou divulgação indevida de dados pessoais.'
    ]
  },
  {
    id: 'conduta',
    title: '3. Regras de conduta',
    body: [
      'Você deve manter comportamento respeitoso com equipa, comunidade, parceiros e outros utilizadores.',
      'Spam, flood, abuso de suporte, tentativas de manipulação social, impersonação, anúncios não autorizados, phishing e perturbação intencional da comunidade são proibidos.'
    ]
  },
  {
    id: 'propriedade',
    title: '4. Direitos sobre conteúdo submetido',
    body: [
      'Você só deve partilhar conteúdo sobre o qual possua direitos suficientes. Continua responsável por tudo o que publicar ou enviar através dos serviços.'
    ]
  },
  {
    id: 'moderacao',
    title: '5. Moderação e aplicação',
    body: [
      'Podemos moderar, ocultar, remover conteúdo, limitar contas, restringir canais, suspender utilizadores ou encerrar contas quando necessário para segurança, legalidade e integridade da comunidade.'
    ]
  },
  {
    id: 'denuncias',
    title: '6. Denúncias',
    body: [
      'Se encontrar conteúdo abusivo, suspeito ou contrário a esta política, utilize os canais oficiais de suporte ou denúncia disponibilizados pela equipa.'
    ]
  }
];

export const CommunityPolicyPage: React.FC = () => {
  return (
    <LegalPageLayout
      title="Política de Conteúdo e Comunidade"
      intro="Esta política resume regras de convivência, moderação e uso aceitável de conteúdo no Genesis Miner."
      updatedAt="21 de maio de 2026"
      accentClass="text-violet-700 dark:text-violet-400"
      accentHoverClass="hover:text-violet-600 dark:hover:text-violet-300"
      iconClass="text-violet-600 dark:text-violet-500"
      icon={MessagesSquare}
      sections={sections}
    />
  );
};
