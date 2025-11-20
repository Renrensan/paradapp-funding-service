type RapidApiResponse = {
  status: boolean;
  message?: string;
  data?: {
    nama: string;
    rekening: string;
    bank: string;
  };
};

const RAPIDAPI_KEYS = [
  "47a429193emsh06ab55449a261e0p1a65a5jsnd2f68bebf0e2",
  "6c0a47581amshc26b1785724ab83p158c41jsnb957d363e553",
  "1d12913191msh42dbab7a3321d56p1bdfd6jsna8e438191cb0",
  "9ac070a2damsh92b1fcb4b4ffe4ep15ba4fjsn6d5c17112887",
  "cf9ab6a560msh75aaed8940d0740p154ce4jsn8ce16e7c634e",
  "a67d07c864msh66bccf1e6eba8dcp14c1d8jsnc57322a6a2a5",
  "084e3b996fmsh11c8471aa13c4cap1b3f2djsnf18998f8cc5b",
  "b77033b666msh1565971eec56243p1fca84jsn6dfbfadcdfe6",
  "fb3f031365msh9a767e8f5e6a683p15f387jsndf41e8f9dae9",
  "a2f86480ccmsh9986870a629f5bep1d596ajsnaa6ccbd4f27b",
];

export async function validateRecipientAlternative(
  method: string,
  accountNumber: string
) {
  const bankMap: Record<string, string> = {
    ID_BCA: "014",
    ID_BNI: "009",
    ID_BRI: "002",
    ID_MANDIRI: "008",
    ID_PERMATA: "013",
  };

  const bankCode = bankMap[method];
  if (!bankCode) {
    return { success: false, error: "Unsupported bank code" };
  }

  for (const apiKey of RAPIDAPI_KEYS) {
    try {
      const res = await fetch(
        `https://cek-nomor-rekening-bank-indonesia1.p.rapidapi.com/cekRekening?kodeBank=${bankCode}&noRekening=${accountNumber}`,
        {
          method: "GET",
          headers: {
            "x-rapidapi-key": apiKey,
            "x-rapidapi-host":
              "cek-nomor-rekening-bank-indonesia1.p.rapidapi.com",
          },
        }
      );

      if (!res.ok) {
        console.warn(
          `RapidAPI key (${apiKey.slice(0, 6)}...) failed with HTTP ${
            res.status
          }`
        );
        continue;
      }

      const json = (await res.json()) as RapidApiResponse;
      if (!json.status || !json.data) {
        console.warn(
          `RapidAPI key (${apiKey.slice(0, 6)}...) returned invalid: ${
            json.message
          }`
        );
        continue;
      }

      return {
        success: true,
        data: {
          name: json.data.nama,
          accountNumber: json.data.rekening,
          bank: json.data.bank,
        },
      };
    } catch (err: any) {
      console.error(
        `RapidAPI key (${apiKey.slice(0, 6)}...) error:`,
        err.message
      );
      continue;
    }
  }

  return { success: false, error: "All RapidAPI keys failed." };
}
