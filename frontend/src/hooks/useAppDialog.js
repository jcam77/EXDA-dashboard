import { useCallback, useRef, useState } from 'react';

export const useAppDialog = () => {
  const [dialogModal, setDialogModal] = useState({ show: false });
  const resolverRef = useRef(null);

  const closeDialog = useCallback((value) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setDialogModal((prev) => ({ ...prev, show: false }));
    if (typeof resolver === 'function') resolver(value);
  }, []);

  const showAlert = useCallback(({ title = 'Notice', content = '', type = 'success', closeLabel = 'Close' }) => (
    new Promise((resolve) => {
      if (resolverRef.current) resolverRef.current(false);
      resolverRef.current = resolve;
      setDialogModal({
        show: true,
        type,
        title,
        content,
        onClose: () => closeDialog(false),
        actions: [
          {
            label: closeLabel,
            variant: type === 'success' ? 'primary' : 'ghost',
            onClick: () => closeDialog(true),
          },
        ],
      });
    })
  ), [closeDialog]);

  const showConfirm = useCallback(({
    title = 'Please Confirm',
    content = '',
    type = 'error',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    confirmVariant = 'destructive',
  }) => (
    new Promise((resolve) => {
      if (resolverRef.current) resolverRef.current(false);
      resolverRef.current = resolve;
      setDialogModal({
        show: true,
        type,
        title,
        content,
        onClose: () => closeDialog(false),
        actions: [
          {
            label: cancelLabel,
            variant: 'ghost',
            onClick: () => closeDialog(false),
          },
          {
            label: confirmLabel,
            variant: confirmVariant,
            onClick: () => closeDialog(true),
          },
        ],
      });
    })
  ), [closeDialog]);

  const showPrompt = useCallback(({
    title = 'Enter Value',
    content = '',
    type = 'success',
    confirmLabel = 'Save',
    cancelLabel = 'Cancel',
    confirmVariant = 'primary',
    defaultValue = '',
    placeholder = '',
    label = '',
  }) => (
    new Promise((resolve) => {
      if (resolverRef.current) resolverRef.current(null);
      resolverRef.current = resolve;
      setDialogModal({
        show: true,
        type,
        title,
        content,
        input: {
          defaultValue,
          placeholder,
          label,
        },
        onClose: () => closeDialog(null),
        actions: [
          {
            label: cancelLabel,
            variant: 'ghost',
            onClick: () => closeDialog(null),
          },
          {
            label: confirmLabel,
            variant: confirmVariant,
            onClick: (value) => closeDialog(value),
          },
        ],
      });
    })
  ), [closeDialog]);

  return {
    dialogModal,
    setDialogModal,
    showAlert,
    showConfirm,
    showPrompt,
  };
};

export default useAppDialog;
