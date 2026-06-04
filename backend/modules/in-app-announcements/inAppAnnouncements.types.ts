export type InAppAnnouncementDto = {
  id: string;
  title: string;
  message: string;
  link: string | null;
  imageUrl: string | null;
  priority: number;
  createdAt: number;
};

export type InAppAnnouncementAdminDto = InAppAnnouncementDto & {
  isActive: boolean;
  startsAt: number | null;
  endsAt: number | null;
  createdBy: number | null;
  readCount: number;
};

export type CreateInAppAnnouncementInput = {
  title: string;
  message: string;
  link?: string | null;
  imageUrl?: string | null;
  priority?: number;
  isActive?: boolean;
  startsAt?: number | null;
  endsAt?: number | null;
  createdBy?: number | null;
};

export type UpdateInAppAnnouncementInput = Partial<CreateInAppAnnouncementInput>;
