import type {
  ValidatedCreateInAppAnnouncement,
  ValidatedUpdateInAppAnnouncement
} from '../../validation/inAppAnnouncementValidation.js';

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

export type CreateInAppAnnouncementInput = ValidatedCreateInAppAnnouncement;
export type UpdateInAppAnnouncementInput = ValidatedUpdateInAppAnnouncement;
