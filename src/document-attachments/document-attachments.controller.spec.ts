import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DocumentAttachmentsController } from './document-attachments.controller';

describe('DocumentAttachmentsController (routing)', () => {
  it('registra el controller bajo "attachments" para que el prefijo global api resulte en /api/attachments', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, DocumentAttachmentsController),
    ).toBe('attachments');
  });

  it('expone POST /attachments/presign (evita duplicar el prefijo api/api)', () => {
    const presignMethod = Reflect.getMetadata(
      METHOD_METADATA,
      DocumentAttachmentsController.prototype.presign,
    );
    const presignPath = Reflect.getMetadata(
      PATH_METADATA,
      DocumentAttachmentsController.prototype.presign,
    );
    expect(presignMethod).toBe(RequestMethod.POST);
    expect(presignPath).toBe('presign');
  });
});
