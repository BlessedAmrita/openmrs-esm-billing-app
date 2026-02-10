import React, { useCallback, useState } from 'react';
import { Dropdown, InlineLoading, InlineNotification } from '@carbon/react';
import { useTranslation } from 'react-i18next';
import { showSnackbar, getCoreTranslation, openmrsFetch } from '@openmrs/esm-framework';
import { useCashPoint, useBillableItems, createPatientBill } from './billing-form.resource';
import VisitAttributesForm from './visit-attributes/visit-attributes-form.component';
import styles from './billing-checkin-form.scss';
import useSWR from 'swr';

const PENDING_PAYMENT_STATUS = 'PENDING';

type BillingCheckInFormProps = {
  patientUuid: string;
  setExtraVisitInfo: (state) => void;
};

const BillingCheckInForm: React.FC<BillingCheckInFormProps> = ({ patientUuid, setExtraVisitInfo }) => {
  const { t } = useTranslation();

  const { data: visitData } = useSWR(`/ws/fhir2/R4/Encounter?patient=${patientUuid}&_sort=-date&_count=1`, (url) =>
    openmrsFetch(url).then((res) => res.json()),
  );

  const isWaived = React.useMemo(() => {
    if (!visitData?.entry?.length) return false;

    const lastVisitDate = new Date(visitData.entry[0].resource.period.start);
    const today = new Date();
    const diffTime = Math.abs(today.getTime() - lastVisitDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return diffDays <= 7;
  }, [visitData]);

  const { cashPoints, isLoading: isLoadingCashPoints, error: cashError } = useCashPoint();
  const { lineItems, isLoading: isLoadingLineItems, error: lineError } = useBillableItems();
  const [attributes, setAttributes] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState<any>();
  let lineList = [];

  const handleCreateExtraVisitInfo = useCallback(
    async (createBillPayload) => {
      try {
        await createPatientBill(createBillPayload);
        showSnackbar({
          title: t('patientBill', 'Patient bill'),
          subtitle: t('billCreatedSuccessfully', 'Bill created successfully'),
          kind: 'success',
        });
      } catch (error) {
        showSnackbar({
          title: t('billCreationError', 'Bill creation error'),
          subtitle: t('errorCreatingBill', 'An error occurred while creating the bill'),
          kind: 'error',
        });
      }
    },
    [t],
  );

  const handleBillingService = ({ selectedItem }) => {
    const cashPointUuid = cashPoints?.[0]?.uuid ?? '';
    const itemUuid = selectedItem?.uuid ?? '';

    // should default to first price if check returns empty. todo - update backend to return default price
    const priceForPaymentMode =
      selectedItem.servicePrices.find((p) => p.paymentMode?.uuid === paymentMethod) || selectedItem?.servicePrices[0];

    const createBillPayload = {
      lineItems: [
        {
          billableService: itemUuid,
          quantity: 1,
          // force price to 0 if waived
          price: isWaived ? '0.000' : priceForPaymentMode ? priceForPaymentMode.price : '0.00',
          priceName: 'Default',
          priceUuid: priceForPaymentMode ? priceForPaymentMode.uuid : '',
          lineItemOrder: 0,
          paymentStatus: PENDING_PAYMENT_STATUS,
        },
      ],
      cashPoint: cashPointUuid,
      patient: patientUuid,
      status: PENDING_PAYMENT_STATUS,
      payments: [],
    };

    setExtraVisitInfo({
      createBillPayload,
      handleCreateExtraVisitInfo: () => handleCreateExtraVisitInfo(createBillPayload),
      attributes,
    });
  };

  if (isLoadingLineItems || isLoadingCashPoints) {
    return (
      <InlineLoading
        status="active"
        iconDescription={getCoreTranslation('loading')}
        description={`${t('loadingBillingServices', 'Loading billing services')}...`}
      />
    );
  }

  if (paymentMethod) {
    lineList = [];
    lineList = lineItems.filter((e) =>
      e.servicePrices.some((p) => p.paymentMode && p.paymentMode.uuid === paymentMethod),
    );
  }

  const setServicePrice = (prices) => {
    const matchingPrice = prices.find((p) => p.paymentMode?.uuid === paymentMethod);
    return matchingPrice ? `(${matchingPrice.name}: ${matchingPrice.price})` : '';
  };

  if (cashError || lineError) {
    return (
      <InlineNotification
        kind="error"
        lowContrast
        title={t('billErrorService', 'Billing service error')}
        subtitle={t('errorLoadingBillServices', 'Error loading bill services')}
      />
    );
  }

  return (
    <section className={styles.sectionContainer}>
      <VisitAttributesForm setAttributes={setAttributes} setPaymentMethod={setPaymentMethod} />

      {isWaived && (
        <div style={{ marginBottom: '1rem' }}>
          <InlineNotification
            kind="info"
            title={t('feeWaived', 'Consultation Fee Waived')}
            subtitle={t('returnVisitMsg', 'Patient detected with visit within 7 days. Consultation is free.')}
            lowContrast
          />
        </div>
      )}

      {
        <Dropdown
          id="billable-items"
          items={lineList}
          itemToString={(item) => (item ? `${item.name} ${setServicePrice(item.servicePrices)}` : '')}
          label={t('selectBillableService', 'Select a billable service')}
          onChange={handleBillingService}
          titleText={t('billableService', 'Billable service')}
        />
      }
    </section>
  );
};

export default React.memo(BillingCheckInForm);
