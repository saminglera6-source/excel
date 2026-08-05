// ============================================================
//  recibos.gs — Recibo de Venta imprimible (comprobante + garantía)
//  Mismo patrón que etiquetas.gs (generarEtiquetaReparacion): arma un
//  documento HTML autocontenido con window.print() al cargar; el
//  frontend solo lo abre en una ventana nueva y escribe el HTML.
//  Solo lectura sobre "Ventas"/"Compras"/"Venta Accesorios" — no
//  registra ni modifica nada.
//
//  Reproduce el recibo en papel que ya usaba el local (mismos datos,
//  mismo texto de garantía), para no tener que completarlo a mano.
//  Domicilio y Email son opcionales en el formulario de Venta (ventas.html)
//  — se completan acá si el operador los cargó, si no quedan en blanco. El
//  DNI del comprador NO se carga aparte: se calcula solo a partir del CUIL
//  ya cargado (extraerDniDeCuil_()). Lo que el ERP no registra (N° de
//  referencia de transferencia, detalle de cuotas cantidad/valor) queda
//  como línea en blanco para completar a mano al momento de la firma —
//  igual que en el recibo de papel original.
// ============================================================

const RECIBO_NEGOCIO = {
  nombre:          "GreatPhones",
  direccion:       "Zelarrayan 179",
  ciudad:          "Bahía Blanca",
  telefono:        "2914727351",
  titular:         "Martín de Mendonça",
  dniTitular:      "45821618",
  // Usados solo por la Cesión de Titularidad (nombre completo con apellido
  // materno y CUIL, tal como figuran en ese documento legal específico) —
  // no se tocan "titular"/"dniTitular" de arriba para no alterar los
  // recibos de Venta/Preventa ya aprobados.
  titularCompleto: "Martín de Mendonça Acevedo",
  cuilTitular:     "20-45821618-6",
  garantiaMeses:   12
};

/**
 * Firma del titular (Martín de Mendonça), recortada y con fondo transparente,
 * embebida como base64 (PNG) para que el recibo sea 100% autocontenido —
 * no depende de ningún archivo externo ni de Drive. Se estampa siempre
 * sobre la línea de firma de GreatPhones (ver _armarHtmlReciboVenta_), así
 * el dueño no tiene que firmar cada recibo a mano. La firma del comprador
 * sigue en blanco: esa la tiene que hacer la persona presente.
 */
const RECIBO_FIRMA_TITULAR_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAfQAAAEICAMAAACeWPbaAAAAYFBMVEUAAABVVVVKSkp+fn48PDw3Nzc7OztLS0tmZmZGRkZSUlL///8yMjJBQUFNTU0+Pj4tLS1QUFAqKiqqqqo6OjpAQEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABDXqxtAAAAIHRSTlMACQwCBM+wTwVvLAHsjDCa/UQGAzChAAAAAAAAAAAAACQbB4oAAFxoSURBVHja7X2LYts4sizxkAgCIiU7d///Vy+qqiFRCUORsp05caSzZ3cm8UNi49FdXVXdda/X6/XRVwkulC7GEGJ8PY1/I+RdcS6F4n10zoXXA/n+r7q/uy4k7+p/HDa9f4X9279CCAh1cLbLQ0yvh/IPhN25yP8J9ZjHUf96JP9A0OtlHlw93H1x9Z/i63j/9q9UT3bEPE9TdiG6kF47/du/PK9wl/thHCbHw/71UL599l63t687vD+eDkPd66+i7V9J5Fzw0/lQoz7VpK5GHaldKeX1bL77Kw+Kekw1pfOuuPTa8t/+5fJwPBzGeq+nGnNs/xck+/3TeF+jjnvdR8X8ldH9A1e7on4cJu9LdB6g/Ov13Y93X7c4T/jsu9c2/0cK9nqJx2yVW0zhBc39C3e6K9HXE/5wOKJefwX9nzjeCcz4qa8n/JBjSuF1p/+FmVmNIQIXXNpWfOGr6zcxm8vecSF85t2eXHRd8LaYwod/9gs8vH+VgD5KdAx63PV0gxsOyOGxZCJ6b59WrteYx5ov4j2VUja+rZhw1biUYrh/1Y8XQ+E/vo4kRS7ipZ1Qn+4eXkQ94YnNZVdPiFK895/1piLwHu9rkGrEtu7z+i7qvZOcxxrmi4QPLAMuS7xeQbcHjJg/eUi4PFrUXQx1r3/WTkoIet3tHlt+67tzWr6Omxsv/hv/rLx6gvOwlQ99d3TTeAIOj8Md6d0nBR0RK7GuqSnjdu82dXQ8Xs6niNXiEXX8N/8wGNnr9eKtfEeE2ElsLoDj8jXqsV4Pn3Z8Jt7q/dBPpGOGTW8HH0AHew1+vXKw65kVdLrcXwG3KAfwW7knXLf7weDG7cfTpZ7w6d1KgE884P1wHHt2c7b93JDqYZPz1Pf9lOvLOUWe+xwZ4SuRswPaT3hIfc7+iW4Z2mzT8cTKzX8eRlNv4lDTQjeejr3bWlL4nPthGMezXiNew1DjP02el0T3CrqC7sF+Oh+P9fn0mRfzju9GalxD0x9xwudn88HFO11BPyPoIW3r16PjezpdTvXNHA71v0+Xy+V0OJ6H/o2fLLn4b0OHdfPUlKdWRNN4OBzb61zz8AROVP1Lps31/1YeU/FgzdSsXVGfsCPr/VAXQtj5ZpRyh+vtjXMZb/F8OU6upPWVGPlh4jScjzXa9dOcudvr5zlcP9t57CfiRyXUmq5DJsNdv3Cdfd+rv9bjQCwSSTA4ButuP+CU7pEuM+FN9TpM7vGZjVKt5wk/XYO+L42/Bf2abjkeyPl4OWZfHrBuI9K2TMjgOLzVmzzhMsednt9w3uODnQ7/GwZueJSW9VZaC7pVfN8u+B5lcCq+Px5qrlRvvXqv4/EcDueeMfeu7aL0oOCrMfbToBMeGBqe4xNPrOBIv+XYKSInO17OuS6/WMJaMooI9WPdz1iyqX42vq2IBNXxgw3Y9/hsA5M7T7HGb+/3mt2muuJ3XAXh7yAJ1qAnH4IfCK10QFGTyzymsWN9LXpLg7N+HyciXMHxbD1or0PSitN2T9ALEmtipbbTeP3W9dYfLmfQL8NatgA1JVt+NdFP+N0g56P1xyuKh49PIHhdsC6xLuopgmL+t7CssNvtrP7yl0h4CXjV5zNeDn292xMhjXo5c7ePLLu5VUK38nlKC1N9ttmi7nG4l31Bx+IimqaTA9gKM4p6a1zGxK3n1tHXetIcjj2iX0OJCl0gPD5DDXCKfso6yewGk+w2Lu7mIDhoRyfhb9Ftp1jjXlyuQQdy7j3OQlx35DyiTe5RwNfYreQ1pZ3iOOHzWLcSsrkCWsWu2ghZtbvlUEROWRnUk2dwwufW10zPmHseOvGWH2A9GEyHCyv3AI3rfUbcuL7FxTS1Pou4NeiFr78p6PWpTrUQzl3UQY4euWVEpzHbH21KZguSvxqhy4XYHNquOy+5lrRby4+hCliAfQ36g5LN1ctFJB6k8ey3xGjpGCoQ3tDvnvhTTfHrp6s3QUZKt4hFoSFXXNyUlRSloH9JIse+efT9eDrnKGwaDxonuqiuNbvzrL229d2YS9WoE5Ht9uOxWHDewPOJmFpdPFNNznoPetZ60NtG5xp1t52ukDMrRYM+Ep+beJQdeYUtwj4BCg5cAFuCjhX2lwQdaRNP5fq0xux5A9cnkniiO25apEUey91vymcCnApq3oW9nn23j0BVmEhij6LM6llmQS5Xg36e2FiPqzlpvVmO9RpgS021llIEYu9KCR06dgbM85Svd/vbMnkbd0R9G37LB3cEev+WoOMWrU9zOOL6TlgCos5Ez3Zmf0btNjmm8Xhsya1/tPoDmcIr6kig2OToFlJg+6O6AxOhN9T0dZtPjDXhlQNxoqmuvWNdktika1u9rtEDriO7Z5idqdC+IXBsvMVOdD7kfcRx6iHPNMAndd47gvP1Nsdz6T0BC0R18Q5wvCHrqVR/cs0cQlxrDGlt8UGXTwQudwa9fviYFHQHzsnt03giI28A6gZsPixlHI0+rWV0gY2terfWqAOHjyqbutsH5DbEoVsPFEdhTL1qmXdZLT0KRQGIejzXjZ7ryUFajltHyVDZnYZsueDjI6keCXUnD8jpxqHeIuRcFNwAZBHBUQf9YtxvqAaWsVv0qZBpjiPSA2aibNovvNEC5le9V3zQ98T/CPV5EPS67Ou+wz3pWhOmxPeVDBpKdd6nU03hca9n4TPzZ8ATBIUU+3qJJ2t9ED/qrzLMjPgpWyQ9FPC4Lo4qvVdzJdB3at3pt9H7ePHUFTqpgsOqwq1ve5HYhLWL69qNRPDKYgqC2wR16oWlTqdTYml1Aueqv2MiZhSuLKX/OuhhFs+QpEkGJ6Y+83q6elQkLqyVTWSlBFAZ6x7hCe/Ah8cZEW+/U5k2jo4acpCrXFb1XB9+/Z4jWj7Z7GxQqKcB7Ra0xFdTJcdbQHfUhpeOYRQYghYskXeEhwILe3ZuLvWXZyA/S3c7V3SteAe+cSyc+jZ/Qwr2TEtRVCjX+K8ygBIVdK+g13++q524Fv1kex2SdKI0bu3n8WnWBc3CTSgNInx7YiyhlF3hJqhHSH6rAT/huXN715x9Qs4cSHKq/82g47c/CPpAXMHtCHr99Lhacj/qamdyzyQg6IbGPYVctn5VXMSZcExh2ZxOZwLZ2Ou/yzwmpsV1kZfOuf/Om8mCXrTTQT24DzpyrSvM1fHCLg8L9vrEIF0Gp4InPFp1+M/13scGr88FODVS6KH1wXCzitvEnFEFFm7B8+kI5OhB0NP5hH5B2JIfGY2CyxgVqsJOkE42SkBsEOgeKM4BwP8yuFi/EB9nOB3qUcV1E/GpFpX6/elyOLCo6Ug8/Y+a+ohODXqYmKVGN3uoVzAtJWlY8DwZrJU7s9iH5Y7hXr/gYCajdQbgqIjCjsI9rhOBJ3p9/BEnClM7tlVxsKRr0FdZFPl4qoWd38aoioYaORzbgAUmonQ4498jzqJAzzQ2ogBI98DyltF5AIB9DWZffwLaVK4QElq4fupTxNU/IXuNXfcfWfXAMAj/nxF0F+9pcjykSsG2zGOra3A0rXReUKsWAVSRFyJvRHzIn7oYNaYT9vhBTW7s8fr4Iu9TH1WdidnmUzpfjnQ06uJ60C/n7OOmR1kio4o36rm8mLIie+HVruZerVvfp9GiXpOFpUSuljIgeeABDTwu6vKIaTHo9Xg/1J9EiBo7rcT/K0G/HUtBrbPApFZRr+WaQ9BL+Y3RSMEpEJCq4GoEeso8COjOFX/hKQBGU8+L/DCq8cHbWwBYXSFojlBvQ2RXQQ+/TSf0ZjJacTWAaSuPzhN3EXuX/89knSyLTrc62EBjzTVE7+YmsE9xTVwZ9IS+ZF0XfExZ5Un3ixvLRCEQKgWUJHbxlz/u2RJYPMXr8T4nj7XSw7YlPs4bivQbuWWxTudq4flYNw/SYp7wOAMTiThMkup6OBN8OdctbnAKf1dj6ARDUpHyROx0Z1jLb25oZgfHywiezca0OMz4EbW+wOY3aLau7ho2tBYT/qgGnFEnLgla2AxmRG+BJedU3+Obj3xMPQ8PdOLjHabhMlhfo2wcWhs//HHhRREyzUSu7vS4xBg0rRKwufGNGXd8TCOWxs3jlqu1DPANx4SVoHpWaayj9JH2DUcGgh5WqDsIuvf1Th9BmH6yFsKiTI4JHd+vgOjIW33A/qxLV+diWnjHIiRE2+vYHChv72txX+uLwzCYeUfDDP84SdOCzpLtt0GPtAqsF9bpNJJftqEk0s9hI+eEXt0boh3Z4BLijUwZRWt9Ousxqld8RtDX8F8G3THo3bNy6cKmC1NLJHQ8gD3IZNj9I9bCceqSj+r6/3q5v6EpVJcm8f+pvYtatMfb/c9N0PeM+sQmthKQP57GX4POOn0h6EFGcWQ9qiuTtgWdPmNQMV/4fbHUAyMjXccuP+MiT9aTXA86TsUzlC7dhqA/LWVAUaGmQ39WGq98stYuOJSH8QSkqR7xywQqB7029q86fTjW8OCAPN42OjtYQ84m/PNtJf8HQV9G5O43QX0ekfw3oB8bf7Ku9h4xZ8YKZjy3ESE3sePLA2gKJypbgHVFbgj6AKgkPH/sMa/1k/FH2I5LPJTHXhp8AIhuGfjPZ65k3QfoRyNTnCPbXrhuPQcmZnMogWPDBf+DoNtO70JcbCt3ScLP/iDSo9W4j+71iCSeGCcBbMO92CwFPBCsr7H2M5DvZFuR3aagP73TkQwmAARRXQBgz+RO1uzsxHoM13q97VJZos46ro0Jhz+O755ViHezoONixHF5nCLKBLTvtOb/PEZD3lkL+lIJbrTk+s6w1y8HbFITND+C5kBDALKDvV6TITHToKDBHVGrv8ZzWAu6C9MZ1eKjgDGRG57Hs6+5ADnAU29qHewEtmx7bE/m9XHZAJmZe48boIb0gvuM1+LdIxVgO2DH1yfC7Db6T1N7bn+5a9Cnuy5bd7dAgVCViABihXq2V8tq0ElsrUs5UbsutYl4KkTdI83DIzuMae3dJaJdU/z6oOMjdlDXg2UDOhWSTb5T3Op1sQqrcH7hgkPnCgfhSBpOL8OtyIIuzb6oXpR1CeMJTlbRF/d5uu6tZxr0psnu9BwWRzSoCSGFtxjGSMHcuoS0sNCjSsaLPgVwjjmxF3NN/VWm+GntHOKV2q8kEiQk4ipW0J+mnus4CwTiEm6L4XBoxaau6axY4soRD3L2q1CZZBR3SF3y2ygBb/2Jt0da2FRGLnes0a7ZDbHK35AzvrThQsF/wVsYc3LvaTG9v1FKBdJM8RGjIYJt6KEtZz4LMRnI5uIiAHoHLVkPLaxl72iB1Qo4rzCp7c21nf60IEVaVrwpvqOQmHVKkInDqmZxKEAHap8pwUi33LKwMYG1QXSR/4SvRLvoVvuCMNLImxO/JHtSjf500Kk9akFf9Q0hXMZSEw/CL4GiJdo2BjNETgBWo/GAx+FoBhExbUKeVdYfHwWdNzEQudC5T+tTO2WeRKSwPfv6WXi7uWAiiji7jdE6IIsDjnoq7knrczPKEBJl+O5pQah3yZ5i+Q+CDrpPPXvrAvZr9wsA9SABFJiz8dd2W0ENa7PaDIpBnXccR+pHD7jynFkapW0dZZEdV+o1C7rBsPAq+aygo9Fe330txBhOYOsD97Jr1cnsbfG04TWQWNzXtw0oa0aEC8zqgvgJWcqCc0/4/492XnQbOhJdzpn3dll5CCD66oP37Ee6Bew9ULIQyDJkr5wlLz7oyVxpSBRDibql1ncZOfPqXrAPgZ1+Tl36PCfqEG3N1hoTBXbd6rjowY8hMWQGm+sKZH068uh0PBGn+hTSXdCRMehA8EmtOaZLfzZ5x+P3hZ8pkx2+EnQcVl4OkWgbLwXdOObM00xIciYSw7SIVZCjg0HcVk83suNq0NkedBFBd58YdBJjmbOj29+rk4LLhpWc7qn2thyJEdZSUUMBN8LgZ++Gy93N6fm2MP44Wa6u2ZhKZNBJTloLOgLqY6nJXD0XAC0s3enklAZKJQ58Xp5MZFAl0UwmtSQBct8UdKQ96xv9Puj+87YNqpUaWOJz554ZrOum/myEvfugsyJvCA37pixvpxlPTIMLsd95IKCSqWvkMPz5rjqDXrOL8XKYyHBe5RgTtEvuTX2ixUoNjaNE9rpEy6jywYeBOQlgeCMUxW3OXtxZOa7jdgEHQQEiV5di+jSDWp67iSUnoj6w1GIFSTCNItpyTWZAa65fPY2NMU7+NA74edAFbuCtHkkN6w8Xau/+i6BTwNh7c1r73bNVixhFnmlDF65XR6KTUc7Gnk5gjs8OBSq57GDgxNBty95Fdoyrj4V3a/3VDLr7tLSIxzHIW6jd6ocxY3ucc2NPUcP8XOR+SfyUZ9byXk3Zyf1cXRpkiwcYG+DznwSdUmUqDtaCHsx9yk0EJtsavpIgYEHiKXQGReJIRoy8LJAEAto8HFS4IRPaFPTzAYFMj4NetzqIkTVl+Cy/SpAjqHJmVnY6Eo7Hh1e3kXTwMEMUqBsIE9YGfRWgD8LhoPd4xX/IHcos/EHNU2bIx9t1f2jHF3OMGLDTy6qPcykaoF0K2f32wQFKJLYWlLV60E9OF1IMXegM8SB0L0uaA7vyN2jHrW35fK53HlhUDxDf0k6FCZp4yqT81dvg+UdT5H6TjBoPEa/vQBLgCBN41sL6GgSxYEbKYN8f/jcleZgNQrI6qQEbf4rw4fmka4ApPHLiulb/cEYXmC+VjZNyQQgnikhiMM9vNpWA7oF5xZO9PvqfnrfoU+padlfq7XrDpR/6us7illsPWPKYnbGncSgFi92H97z3ZliFm9gLXslsGhCbnFMcuR96kbiJsA/ypp1hrbStxQ05uaRLgE4vIfo/G3R2NYAlbT347L3izgNdHlZEyF3ym4wo8GzCT2ewcAl2Xkin3sQNmyie3LQFQHUCHdbLIAl06vQpSlLSxZSSgFkfZXVOqZe5FM9cVnH8A8ULBsdynQDjveES3Pp5FNnSG+7hKcr9o9Bc6tFmc9tYeomMYX1wLfTQRTGhzrIoyhI9z/kRpJLLLfqAR7cx34p4FmlT0L32WHBSqPXcUJ9hQ+5TEdHkQEtM/PhBBfYvNLgOpzoxl47NuKynFHn7zfeMN4aNrkp6PxTwy//ky09nnMjb2hXeF8+KBJ8NmyC5lrI3cwc8jHRHiin4I0L3p4O1KLdssiQYZAs6jSv0NMAbjjYGI8/YlNKDHvCGRe4hqcOSJrUX8og88ioRsTHObFGjJ6bN4s5RF6WMLZVZMxHCzYRFdJ7AyWo5gv/DUid+it5tO0dhBHMlgyHo2F2NCaVepOeB/9PDrkdYMarkjBYR1jXn+l1btkAieicTDdPfgZf3PFdyVo0lzx7xeGJ/GOo1Nk9pPhHmQCYTnEE+HOipOfXiYegS5jkC2vYW60T2YZ/+dOOlo9XWwLnYW/YfCOAc3YKCFZ+U8pCTVWkA86n6/ylHw3qXu8WJuJUnA2U1e5f7zDZqeAxZLAay8ZomJ8SPO7yzT4AeJFfsgB/q+6bbp+F0mgFFIG6xSUT5y2TJz/w9sBUVKXPquYL6g4r7P7vTzYBko2aaI3WdaNw8x94Gs+SD3LQEyiJBg5tLn9FEJ8Cla13U0StS9bvfRNuTbUkfWXLIFmBx4KFHoofGx4NO26LE4kS6bYm2aun+RnpnuIM3TNpzJrO9dK1BN7/qQDJIwf4G1pVWAfs/HXSACo+Drkqz3rQJ4PN0RuZ066WZ/lAFe4p3M7ZJcac3C05G5PADSulu1ZQJKS+p5n7TrSMMlC6YqB0PJl0OpiJ9tnirbyJFJllMzSk3dsTNsT3pmH5blFgbyM2YtKNqNGYUPmZ7AwkYVtSP6L1LyWo7nnx/TuVU6K6N03D1VxYuWNxwPNRIKmAFq8f7TuipkGr2s5Sr2H8C5WEXmD9IR5LW9iGsX7pu24zuxgVBSQRTQJpj9XQ4MaH7kxURURqDVVi5od0W5U2S6al5hyMgrdXN19HIgBcalYK3Tyq2lag2uOZubPmOvjd/iEuDoL898kEhZZfVmVrYNZ+VIRCuz60qTB7DFLlQMxY/a2lHNT6n7h0eQsWZrh6pEtCxUlz8aKYEEFYiR2dFV73W3+GkWu4qWrXKZW9g1qWT5gjdv2O252GAEVu17mSj/IdAmsQTac1FCDZKZCEmKYmZztKeY5iYhWyLnhkWENSkB8FnFSryftGeKjSHYtTpE8c0u3z4YWLFk+aJGHYwKSJG4+fbAsdKoYoVnXJnBaSsthj025toG9xLIXo6T3SicX8oowvI5OoRvebJ2FJ7wpzAGN9AjKA5JBtSG4OHbK7eC3whwfm0Twhzm942GCd6BPV4iKLIQ/7DQcdsWfrLIA1t9QsQ1HILOrAFSdpIe0QaSKHE5MTsmmleg6V8sCKjhEZ5/R863us7BYjZr1bE5MOAHAeMM8sLim0zzwl8ftvMJ/bq5DyrfvtndZNLTRcAgU7UO5O70+bAmhPoR4OOcgQu6Rep83yDA2bqBxBLaK+iPUzxOkUv6kWHFOdCZ2XwWqaZ9AySojv3R/L4AI364fBASEISHQsYM1s8D70aB46GGhtREHpbIBosdbtPW9awLcRBCiVmV5J19q0RKtfP8MGNTkvx4WB7nYPJoGVK/v7zqQqDysrTdZHAHJI+quXmQWfVVG+k96I+DvFp92c8KuoKhHhnWNt2JqyVcQihGOzTRhW0cmUTslPEEWcK2H/ekE6CZufTObPDT98UmtBJeBDjx4MutWdPkzwCUUrmJj873gHbRgn/zihPioyndc+EO4Y21PTWfu2CyvtRnnV/JuhIIMHkXHksSDCiBOY3KMZagxkW3VuDTskDUKjDUT5en1V3siMAq5Jk2JCjUEGqAnJqPojHinGCSvVEBnyMLYW/HZlS/9GnB6qhCFw4Xo/7uz4A26lQw7B1l/Qt7MX/IXAGxMK6SVhBkcc8P9WD8qR47Zdr7IMjLj7w+9xvLBoW4Tz8B3jEAeW6WXHc1eIAbKEPtWEP28B3chLABmGhRP867X4ZBdW3+u5+M69lR7YI0LlRgDyJElKzsq0Ymu43SqDKRnnymk5R83l8wbwNCzpFr9EpeNPm2Be9DQEuX2wsXR8seRG8s9MslQBPjBMxQGSfeLQB1U6QINILNR85FcLvIqLWeFCve7xQ8q5Spcxq+ULzoWZ+sinZi+Qk4LQEEVtzCQDU1CSbVzAshYt+9weflShAnEZGyRMWPfBGn2bcVzdcTr1ceoAm5/PhODrv75gSQC5VrHtaZ/ZEfjilAF527ouHBjDFPI5TIsY6E1vS3IvqYhmyHOUpYEbq1lSChKdmL3vKBcL9Bzo1MmW9c4o2Q0kOF6F+ZdNOx7KbKDKhfAo3Do5j1QrgiHySwUvgeqV+OZqsIctIJfo5PihYDuUs1Iv0HnH+DpfgQAWY7b/5DswB00g6DSNzX20UbQ5SfUwqc2fQq6JuzrnsXXFX28gEiq1ryvwe0s6ge567Bzn0uHkaj3OlH4RVaeRO2XJFga6HK3xAX4fmIcjo636ZZFz/Ux71ka1+JUr6lBV1tHS7uXKteCZmNZjUgDClRAaT7luIhV0C2BngLkJvXcet7ogvPd5JYx1Op14g4PwElNt5G3vST+Ss082x2OAy0n4B0e0CtAv7uUei8LQCm3nyqF9CaQvT7rSJ20HZZCYFFTBspN2gxwXlZOmEm/4z4l7XORR9LMOCv9Xk/rbTgwMdCRdf2x1dll7itjBQtNMsHrstKNXpZdinG6987ZUePIjaKNq46eZeCxznYs4hGnDEUtKEvTxJSQcIcV/SKWjidByt4TzjEHhYk55oIk1zx20cOUeL/USbEMdB0UBDklgVSKtwCYXw8SMzOHEjDtSnRC8DKhfv5X01F6EquahGjUSfeTbcBT3Kf+hMgw77WROLPh+6L4XmOHEniYTQ3Z20XTBNWo14T/qmN2MXGHoneAqoGd/DQSVsOtjtI3s+hsN4FvN/lgYyDz9emIiTqLPlByeN8EiDRpPQ9ZVEDnjNSopI20dK7T52tddzDkfykaKXZIzw3t+h5rwSlY13ZnWO53Tu546pRVF35vWAZhY6zzhAIPHvvvROp3o4qR8d/D1KxkzlMMpXKtjsXc5wwPv6EZ2BiXkbknQ1F1K6ymmfJNLMt7Mj8AVGWoZp/7Y7nb2OLpCdLfeMeKVZU0JEiUr6SZryZNQn2pOIHxnMq2FuhNguPgSwJTHspWFb/ZTcWDJIkBsgfJODfXnQSyfFNHuA8+Mdjgy8yh16lDXvoOkvHDAx8Ji2oZ6CYhwDcUfQmW3ndsDX62H23V4Q50WE2+07E20WJ2iR1hIx8UYFEU0aa/F1PrzTzUakPxOW7EQCYwp/KzoRQqpY6xHof5QSk1mK+VnjkmSwGCgZmugsB/LUhXCXmUV/YdAhnKZiGb86+PlRO/VUq+iYpJMMU/rC3InoDYtQeusVUrzDpqDjsmbqP1qP0pN6hLvGmyPAhaLo5rX+eMOzs5lpzssSUEGH1ABGAW0PBffB2q2u9nfe6sMR9FigUjL65fMgX0L0+6TEvCBjqtvEixeXojnvMugaHIIFSbZ+AoABnizyz/i1nRfigI7+Lsbg3/OSSYhJuMK2JhELGRAxYJgq6hl8MaiRwk1uFnTn7NrJvzHxFgBaM4GbhRsAvtQ6rRBiuo8d8I6OXPXXjACXgFPJeEsfgRObsRIcFYpatl5+2uq80Mpl/mnMrwY5U2e6daUBXx10ysEOtMzbl4iX1lSiXWDqtuFIsqWNbEqjgVMf2TsH+URqA8hXYBOznyhgLKXbVrbqAc7vmoizEqkxz+RMZyvR5p6siRIdg2r8tFo7MdwPlptregnnNunc9pK6A8eWqwEqyW7OhCeApOGR8iTDCedK+mpwJlLoQk39xolH89yfM9EYM79RvBJkYSaG6XCu9cEkAJLOB0AF83gxjrzmG21dvzCk6ufGxTHQhtCO10GHWaSx+JMbPfBWv9AS8Zw1uV0G0DDPM60TEiXeAp56RnhtGSRPNNb/mDU5k+nekIBQTQOO+FfvdE7pIK2MbO59d4lLOlMxx8q5bts5Efi1UNeAYTgI6tBUc3kWqP+KYjEnAjZua0iYys0+QwjkmiNtUTZnMxq78NxD9alTY71muKMMR5JtYiZjBUQKfIrCX3jO0r2hJRUnM6vwd3mTo3MFCSAYCqtyyH85mYKbG+twxIitvUGXn1JmqLptXbHAIsAkzMeBSKnmnsqRDOI+9V9RabV2/pbVhMEZ8m26XcF0vQze33L4kNyzDTd2gnRG9Sb0cd4MASdaLijo0XRvvdfQEEJZKPaGnOZ9Xrp2StLo2Wny/CL3tUFH+ZUKQnfk6IydxDWlKECNvc2l3URZRqYPTwPJ/MwGPaBfW4j4RxgCHs/GX384xOX20oF1h9vUdwUoRJXbgR2j53c65dkdUYahldhJftWcBcCcIWjgp7eLj1xvzHQXJdr7ede8RCNk9KJX4V8A4X5t0LUOvVlSuJ10A4oThRpHXsqbyHLuCs0R0RoGQUCBg4ypfE9+QFfP9mbYCFYAwRYAP2vatd+lntu5p4nn0zCnOpFE3DCpgaPBaCkmpmRySU5ncEIV5IXWEfBLrF01Y+8ooYRyBtaa9QBCIIYTM8AvDTqkAMljLIUlOvsuuZpeTyMc7DWGd2MiF9qwdthKDv2opPUdjUXUOCHonrR7eLNRjbxF+1tEZWnMmYClufYh5XoW8aJHopOPzhFvke3QGx4biZ3LWq0TLOeMc4LkZFIz9v3WeZEdNPlynvNuLLHL7mt3Og7PqNmVvd9JTAaYQjYFbnWftmZc6tLhNJx0rVuOA1FCMKMHTjzjmCPPWc/hcYmNup7W0bgmcHM5cvUDQR5nXNyjAKdotiFh50YHhyYF1glDb57fCCqTUnqKOaExEbA/K3iyphLpwLz8vZwuya/CM/PsBaLWdPK6JXkqqlOQvpJBJaKj2+nGhgF0qbOrwe/NPwDmOILXhkqAO6ZhSiERqsoNvGH69ajPWp89aLEQjqbEaephjg14+aDg5/kiafnT034oXu3h4U54lyU2hQDeprUnCoEIzNNPm5K2Zjfqaa0J7UiUOFAHlC9s2HnjW0Hp/7X6h1Zw7wo6EiR6NaBQTXUH7Mw/sE6g8BjeBGazcKMfHX1O6urXbOep+fmsa2nQTWUZklGFxLnsG6ctgBqbLnitg118biexEzoYOZLFe0P95D4VeaT3ImY7IhrIBaLV9FGlKB2UxaGwNjM6kEJ/ejJWvjajczS2y3trBXDlihPmGPfm/pwR4/SwUJnT1yAqjQ9WFehEdhzlGB6kmSkVzxFPgDe6uY4YPR1Z115/nlEQnww6G+tnkf9xEYerPyhbfFJceOoYMi0SHHGiKB8C3EPFiTyrGRJZFoX02I+1bjsJ7oFI8iuD3pEfOe3MGtUustkGaee6TImT2lm35UYuJTgXXWxNaPwFoUnyctd1c8yKBhnRljSvJSL9vzQokD820Xz+acdBziA4jsAT++TMEdzceDRVlrCa5ZUScKM8E1eC2V1DJTjwgC6OAzuaZvZxAJxXvpYVLb7iOO2HqGgpw4+bdvpoOF28UuZnofCs/NSyn1jJEAk5w1+sJPHP1zM5nZSxc3ftIweqD7y5mUyRmMSd9yxKA6bzqIYRfVPZtdL6xNbFES/+M/xlyO3BGq9/5iUS8Ty4eeSjGVATlta3AV3eG2ZLZO9Lgy4Iqbgngt7JmyLu9TWWu64RLDn0j/QSUKhS560pLW4VQA2a6rrVArJIxjbAwnUedDmdYyqTIwsPq4hg5HNBR9bt0WrSZSFzqUgGHQpxHixIF/VMsbaET3AyikyorhdpEGQoCB55HMwVZEMc7yYUfwU0x/kFw87WY31svCpRi7xdzRq3P7v6EaExxVCbiQM+4UFa1HzwZq0MnPIERxFAaWvMW046pfMLy+d4n72XQMtG1URs4TE2zwWdUhbc4SNPIwQdCjEuOPmt0QeD812MQsPTgN6jUrG1dxc05oSVWo8pG+BT+zdetl+MwSNtfJPYbmdjlpNn7fJKOwE9eDdL5gfURBZbjmyKJD9lMcvhgcBR1Wl15ctX1MFXtp9Cmk/25Ghmz5aOs4E0pKt+4HhPUjZhwK5mMyd35cJTfk8E3rHoJsWTBVgtSmVQJTWznGtQnMnJZxLfuE2DyV/rE81ks51VxE62omuYySwV5G75MbXjyHhYpEyyT2boIhMdNDHPoE72cvzwGnpsFwOpO/Pxu2zO0onzKIakm2GA7A6xOUBzBM5Q5h/gYNlNNA/Ug6FOl6seOT8AZd7O8owWbOHKFZbn+sb9p5nFOMkt6DL3kPxgsLlo6jmRM0aLsvA1OqfgJXVhj3i3Z37QgnmWl+LfeOSh1iU67pNEQWKIXue90oMcZZ4AEGczxObAgSOdXG11EvStmXs9DCjioeqEA8+prt99RFHHiqLlch6Px+PUiW9frCs8aMYDSNzJcBeOLeOozeid2YRbTdmYU7DTpx2Vtzb9Sb11mfDGrwm65wboCRPVp77vnFd/68n6ggApTAzV9UYsi4hG2CfAZ+Xzk+VVx32B+gcH9t0YD863RdV2kvIk/TLoEQOAyVERwv0e3ezU2Rd0sojr2z3Wqo1tFQTdXIMnqp0A20xvNCSh7xyD7nxzEmuDgPBKGoIBfVniUkzeACvwccJXuUpCKaubOYa0HUc3ANTlm8f5E21qp/rMmXwAW1puHjIs1l6naaOdQVQjR92dd4V6rYCMoyuHv/ugw34GmQENv3jCRxO67Q56ip2MPjHqlVPncLIk4Q4gRpGTFb2NnXLqBQiEs7MolWuWCVjfVG8R4hnwxN/UclWH7iuyeGbMkY84iua15yFg9p4+R3kuoaD/JhqRkw2fp5SvRJkwTp2Mfkgxp5ggZzFQ4i9j2AMTwCMfe/h1B9OnHbevjbmXTnT320YrJBZtWbXISDVk4W0Ng3cSIMnPO9Ck2hVLLjpoijCV1YV5jlB4X+A4KzruTcHMzueXQHNYXj5JL4CiPe0MuoxR85O8clBB5f6mO3GKHallaEzhmUavilKznXEXUE4p94HbOESOFPDTxKnntfqxnXQngXf0LEXEjLxuwdpncAYAN5qvBgWnxtolEbNNpq23Swkayd1r/LwFPUXV4ewG2snBtQcB/IATwAZpCMgJGhf0Fdk7aIlyinWcjrnvPIlFEqfu6aCLK+Y9iTRUIPJcy22cgtPfTDYogjoMPpubRCyBeZNryMcjJOKIr034nLt5Ukwe0NY9K+dC5Vl2Jq50cIjEzA+EzbFs2mQ6m5hNZWK9TXob1WrXN9wWJp3k6ar/AIDvRa/OggGiu9ZtKYYvSd+poApN+kl5w748sMCqYng2k3NUthxovaJ9opI7aPJj76Xs5Hrw2l60IUbCGWeNACfrQAxjGCa6pLDAm1nDONfmxfprpt2luNtHlquE0wwPMFjwUawjWCkwIwYgS/NUa5DbiNYbfYR0vuvtoxTeN1fBIlBZLlYTZ7d+RfLOQe9qbeFc2hd0VD1MU5/b6TYSRuJOa396chNiubnsqueIsY5Imk1NO80SucQh3W2Cd12Cb9n9FHQCmzRMARTY7IKC2x90qnhr5HsOIBsIJwX5H1PgfWorV4tVHOmrPZs1ed2V0U+5iL/N61MP0shTnOv9JeAMDqIEAjxgofWZCpqmOztyCp2S6zHnRGLcWVVGJm4+m0ZbJoo+2Aj3bHp9nzgWpO4E4hag1VDoaMOQ2ZMqanEezuMZ1mcUcJDF4qgK9CRisPVJsYnaoRMeqW9DYDYeoyzAAvnPdJKEx4m5pjDq59PljPKLsyvPorwbew5aQLEuJt0tNrOXjmTS/IO6SeG6OQbLW/DTg143A/Ja6xCglFldIS7cV0Mm2gOICjw+7VxxUiBaQu3eznIDo3Dbh+bIE6JERIMNs0d0WXYRTWrlbbSBmRg3AQKe090q/+WZPztr33y1oJLfS9qbMFmGMWq4HTppOG7C1QOD+KIzce/1kZEYPZhJBqRrt5Moi0/fgZAiop04V+ULUrkgiQVX2gg3poebtcy4RiCG4DLmxkMBG3euuI76Rcy2BHxlM8Yju2ZR9rkQAjqRIM4DO9diOorgCjiMkGW0s3XMZN1wNrLIkZA0Jn9n4OvDDUsRqF92excEJ2s9kXvIhAEflpOzcWvjCAKb/di7uxLVW18t3EEixejUpjbzRby+yX/RMF4CmppRnMGFd6uIOyfqXoPedCmaIr37eHeyOwhttqW/jgxB387z4uhxfpI1fWQfm/rBiRZINvW3fmUs5HTbpPIsU9JxyEwJhZ/MMzrQ1PUrs9l58e7alc6ZU/BRdzawTJhWQjor6JhzrTynLod58mEjnbI8lW6Jpqa/qHSB5qXBd1/TY9UdRStwSP3i6pfSP2Me9GidbPGP9x7vomJ0XbNMVVdVPHyQSQ2lgCwjklnUREoTFa6jDJWpW+NEKTzOSSZJHImd80/zJkxznWKrqnFBSIq2b6eTy4q5PtAihQIMlQlZZ8mFWm64wI95xnwWMUpTANysT1WKn7TEZbSEYl8/pvuioBe7ROo9mfyDRO5+4UnJk9mQf1fHtey6GLuWy/RWo8jiwatx5tjPYtAx/nvQBFQilmYxTF8IWaI0cJsuh54WUGxNw0AlzicxJBsnKs5OzeblfLkTj60H0ETDFK95jGz9JXNVPYol42wMu3l3BXNXZgOgh5r+FnQDc2rpylkmIPd4mwb3FaMfzA5fMJB/ZMcOUsKteRXU0+wPF9H04+7WS2iaM/NNJqwtrW+kNeCFXCoSVFi9CoqnXmmkwlWk88Dy0QjdnlO1cLXLHWuemxcgUJFNb1rr9LKQ7vay5mrU6y+7nHoWgxBnJn540jVE+jTeVD3qtRXYMS9ODFqe3H4+u5WXvXxUaEXchgUYBfyTYx+tNQ7BygMvhEIWgZuXbOSsXGogCqGpfW+t0J87cOdyoFm6Ho5Y8jc5cKJmcpCp8ODp+DwNbZRMPV7R84g0GDuwrw1WnM54CqJvvzC8O+USNDzhkJGC5xp3AhRwxBovF5T7wYgwytKjhq6iJAx29QkYViVad/h7a7fNr4tIty9akaKJTOkjhwWYCO6TMzpOaQhQV459Xuewy2PuxlKIdIPL5DwwTDtdPjjdpgDzxyc+0wmd1Zm02rLZ1VyWQEI5gq4RmEmy0YMJdAC8vIerWSQOe/KxhNveVG5iinQqzunk/aa2+t6g42YThBIt6OTBk+/lbiVhT9vIZIaQgca7MCriFIAy3+joWJpBsIoO3FGYuSKAZuv7Y1ZWHvaSbOc6eiPEaNOSlu64eqbVapqWNNezGR0mdcpc2c0mt18C1LKpQCRHgYk2MqxkwM07/4VRht/clBO5phNOWOFz9CBotj0SskU744csyjFBfQ3bozLBOw3jIWdvF+CpKR6yGXfB4AtBXfKZyoKT6mnCAwxZHmla+sT1fddkZaKaDFYNuN+wTid6ACWNNsS7ovwBYxtD2K7Wlxply+6jefXl+OaFUi8GnZ0/oxJH8hlUs5N681TQ21mTukYXvVk8gAzhxQ+l5QXixHv4xOyO7SF+rdSOjoOwyFsk80QTCuRbrk3HnktUV0OTFINBcwBp9mob8SPgCc5mf/Iz1jXRXYOT/GSWe+EOWvNtfp9T166gleCja4koON/IPezTawjarkxpMwg/oIPgOKd40V0zcjwJnjqqO7AvZJ7j+zMr9fIsuYfuwlK2sf0gegtpYn4yR23aGdCxBn5zb5POaX0XOIgIMhjuEr6iWVGIigF2gljSlAZ2A+GdpqQsH7fvfuMPBEw/GjnsLei8K8P1hHcU2RFdnW2jNJnREE4kECmQisKsvvnLIc9h+XeWtn07CB/kWuY2VSOoeCRrIz6wNJQ6acyBzeUQW60eCSQVoD5+vg/IOzuzqmU5cGzXerRRCE5tji4yhvCrAYIRwHubhM8JQ3Zt+oImwlKt2A/ynia8a8UHg06GmwnT/N6oo/yfOK4ChkszmXSiY77k53XtyiX4ntR8G2eJA4CiWHqlmJLPyQKB2YGYGZCObT3eOfo5bjOUZj+Y0k9Eb9H7A6IDErMHS6YYZogse8p8ZLD0XIe3IHGBxgcorDf3+5TsPhmEsjtD7w7GgFT3LF83HC7JWuvIKkDWfGBPaLbzmUIS9kILh6twR8U2F2/vKWVBP4sOnGZzuDrCmq5Tm4jmaz8F3et7iQ15BD3o0jFPEifEidpVAXXxnhP4IOgGQm0DmWTo4Dh1agmkCTR7Q+9LA9BAY8SphEbjqXdd96zovxBLlSO8ZlxKyRbpKqjeAy9FlevobxGDpXeb1oUoF11qYhfgeqovQbCfhvHQDIfkYs7HHJkm22Z64nifjsfRWAB33Fyiamxo1DMIbB7m1HMNhnpImDBUyzmSe7E92+Q2L/myBl3JFW37+2NeWTYOVQpq9bx5M0sKi+uCnXcNO1QzmdsLOaq7M73f9Up0ZiOOSqYc1T4ioSDsxGuSkCpNS7lc0IT1Enx7ZfzCb4HZX3NCfIOYZ9nQ+sySmap3JrgaNMJka+fVRKeRGvQzpwzMkUrdctwNvIsuh8kwjfleV1+NqSWt1uiyrbR/yCZ9YM5vWPTm64fGRRtFRwWbttdFwyikhS9JNCivj86kvyjxkXgy6DLeeu5K55Rc3nSEVp2QuUwsI8q7S5xzasKBenM2vSe05Fy72CfG/KYTSc7MKGzK2AFwPMCFRPjDjEqysN/ngs4m0E/GCUX0Ni/r0xOO9zD3nAk0YW7cID02ih+lVwZy6zi1QLPmTjoStu4gP6FE3RR0toWFhTCfXNBN8oSdZCKcJQcEy62ulkz7mdg9eaf7NhpZTCbBGwdzaetC7s2RBxAMy7LzBZPSvLEbHQcljrpy5OYlhIezXbHXoWBUa25kSQTqogxhoqmSjnv9XlrQ+6wMYu5cVZJGCdFGHQxd0GFmpbNDT9/6aniE4r2K0q/EtfMSvwcdF/ZZN3UIakZE/4NAbX9c2/KkADjNsaRUZ+G4I9vIG7zN7fGWRS10Z6LEDy189TSSBB+3dyNYINRCPxsU2WwEvNIb0/mmIB4SGsEXzuYyZgdh7sGGSsHsiWVyznyQbNjBuZB3bK3evDqLTjxVlQv4BcpatsS+yEiqJ1tDdoHJWTLW/looF0i6E0jGc7iE4jxrHfMkj2L6RWfnTp/Ei9Uwa9EIYqKM/6ESC0xwrmzxNVeDztMTVTGWiZvj1bevIdRKuoXdo3WvF3aE4Bbu1o3aCRXpySRuz4VVG4Va5HfvWqS90hup/LkZwm3srZe3akcuBY/48U0i1mwYEuEuJ4JQ8H2D6+3YdzpgyMI79GYOELcFvX5cBH3SHJaJz3h+bxN/42Q+zI2/4xvhe3G62aYG9TkGYUviTqKnFDTqIf6wAYj4KYCgHrEYTbulkjqs8mlRpUUbKefi8vRjeloSuMN1SsYvWUvIgPHx1y27ghqxHM7NBbBYFUr9zFEX2ZSfTG8OF803REco0K0FcKw9p05GRQJq+onCp9bUKLKog/QIKnHC8YOA5EjAE2vIq/fCwTJb/ACuOx3ByPKKcUagmwe92G3DkWvhDoIEP88GOgWWAkja6lvpZC420V/Q8/o0GW8EYPvQ1NjR1eGA9MaB1bE+643iEkoBsvpQS9B74fwxmkqZlFi2pwx6Wc/eyfOMKkxZycZFXLC3eiuJBT3R1EO5FoklGj6NzX/RRSCbJ7jxXmu3xlXC3Gi1iAJzNk0XJKLoOWS94yr0YmU2f5AtlQ5j2KsLxpjQN8fNbIz5AIshRPc7nYQosH57jQUJlJQ5JmDCpsy9BO7R3rUJgIVTiR5kaI7dSAIZmjK89vXommJQhVg7ix89COuQYxaZDFd5IaZBULm7WksYCsH9GZbM3NAZl0GFTw2OmnhcE+PARECC1XX1cT2r3xYlZYhioxKnaVJvjkTk4Eid5lRX4Bt5XHqDH3E0tKZsCvuCjkWfz7rVvevuGAW8w4L9b7l7FEV2K+L8e8pMpmEg+5fduxtDGxeRpKzGKFp/f7gO2bN60xeueubxBGTn6MIVvyQ5R0/FGXDH+8/mlfOg4iSaVFbhjCLtaSq/uWnQJvFmlu3ouImDk6X3IFtd3sbBqjQZ9zUGj2tMC7hCICUjmMAxx46KRZ0kvjXaM29bwnZd8qaS95tGapgJYd8E5+aCiLZ/vN9IbLNH9xM3B2hB5OjW8WT2wcFRbzWZ1xJqj2TOFs7Zm+vY4nKPWqtRi4R7fX2nQ15B3I+PvPNLC0pz+mhkL2scm5hBCTBW7Gr2TkbI1FOILlfNhXufj5Ak4eSKUVCIVAhwEVVH0m1c9FhytoLYX0nK+v/Xt+LdwASCAFF658RsHU0Y3uuFkx+vExT9FnVw0JyGVuuYsQDefeh+DboyqrkVa1sJJgX0rCEMa/Bi/cAgLdHNOiVvnlt+g/WybM97G4704C6AwImdR5sj6BY7dnR6y60rkJqzNoJ+zo/xuPpxxnEcepntxYXDIPmWt7hGcO3JFm5McFbEIsxenakgFHNaMOymYgY0Np6l8M4muLp2T+rgkJ4GC8oT9JG977RFJ4p+es2RGHTUkbJ+du7erfKa8qEmK3efNxCHk1NO6w5prBiLON41NJtNlDXqQQtyfPD2ElIm3ji8+9bPBaY1pWhL9Ys+lehieXhHS57sZruJV+5Pv8D9VKh0GmV41JQ/vwQ3MBNq0xDUObXmCVgWHK/H2VLsOtnqoNyWTgS1FBazTj7STo4f44SMXF7LMdFILhjX6syyvindmrAKPMay7hJe2HoOvWo1pzmQTBNmuopgRFf4mpefgy4ZQ1NvteupbxWl8qZIk9T6xJNBNO5x44UN6WYs/sjDtQRTejKNWDSqhPAS/KbA0bxAhqPZ4vXDQN9JFkKiD9XERPvIaZJB1FABkB5ORl2jGfcdYFjDFo1ZBiJEQi2lyfJejjF9kmKFlZ+6+ySbCYsggq0JMwRhjKLIZ5o63BdQCRdNoVGmj4yUNhHxSl4WmrZKES0cEkkzBwS64Bkfj73mAV5pzd38H0uZX334F7yTwL4aVg43tMRwQ7YppMb3KOyAiRJE/9m14ht+aRxHasMiNvkBRZE91tZHlKuxk3YHstXzMAJhpu0ygs6hOaBVEUfqSG8Aa1I1JJoUsmqNFJzNQem6H4MKqEFyI6OTGUaLWsGrZgNvu+UUSRPjrj0C/Zrsb8RUjlWZswu90nieOXa/XmegB7lPr1dG9Z3XoL+JMCZMNTu/V80HfrsuctzXXs3/kdqtI2hWihnyZw5/IPcXh0dZ4ZqqZUzrswn4y6Z+LNXqK8dbMCiW2QmpuidOpOzUGTYnp2E8Ywi3o/GG7tRY6MAx9na28pMii5p37ClHvHos2ewdsMvlrk7stYgJKVYSG9A0orkdcQwommpSPWpyz90soGhNMFKpoqzmooktOGxibZwI8Uu6zGdNBffG8Nk7DMclp8FXzuAGUTvHvpcBmY0pK8h1bHrII0SOGiQRBVi3bcEdTJdxHTKwcJIE90a6HxKsJPsscFTp/RWsRQhSCSguPD+j7La9zWk12TE74LFxrlqPlcetVCCkrAc1np1pQg893PoSEXhPXumBNGYcyTMLgmlSxQ5dI4hJPv5wfk4uLG12tHGrOjgGdVEYDY3putWgc4IlsQPgojXD5uU87e0z4gbLR7ngorOJQYc9+8TDWYhPMK65swnMD4VOhIOTaHoc97ZpLDmJErKuvjIxfjqV2FniDibeRd0usdnQgo7YHixng0IF+SvNNCYZNNjZit05y02Ibrh2+fciXFPxy96YDTWKnP4N2uQVQOVGL3c9ZZZlfZ7MzlETNG7z+gjYaEb20IyMHIdS4rPzDgkrfWjU2cxegyR5sVHc92113w4w4P6ATYVvUxs582SXrSJpko/GqbE0VDtZczK3efxZ7hjVwl0KOjv7IwclsP6FZKMGXRPoGHSZ/rw17RGfcMI00c4mGKg+0Y16e1vy6pAThQBtFNEma+yCs+/1nN4XHDnZzX9qdglHRk3lZO+m65D7mUm5Ug0rjlkLQW7sjT3lw+PLWf570sbQZUJGLHHf8c5z2BY4EjD2fFW7if8fW43oG4eoFd/LyZwgQEA4mkWYt+EOWFLE3HQF/vqzizxDjOJghF/Oi9fpAuYNUqlhyv1ZRQhINZiNHiSlAZlwUn0yzcfpkMTJ/rhl8Ihq03kncyLpCVByDI9kjgc5DN62sScrvqZzTCCmt/Fkk3bn5zvZFrG+jaZk9DSyVDXiy4NOhaYKCi+hPt04Xnkvj5rLRRbqnGTsjTZPqvdxmkPUfrqeCWtBF/KaJKXbNheGjI/mbbiyyk8nzrPUb0lvx4vsbi17B5aCvhi7ZizQcPDR9b7NH3UmIZzuiiMr+LwUSj1pBTqnFHXRSFgx4VwAisq+KHKHGTkRlnieVX5NGLOpjBy1Di0Z9Q2p49vgeCiwKhvXKq71JDmVWoN9nd0LEC+f0YratdMDZyDpAAMHqXBUo/F8TrBNirOgm7bdutK/DTpzt3RDb2npGopba3s78bcmhXDhK9nPqqnclFA+cJlkzcHGpQ7LtrqxzVrB6mGce4ntZRQTfOvvRFGOasRfu5KtiSRB2Ni7tggPynA1jhinYmcs4YhrvZawEvkXNRNFCHjXNh4GGZuQKhlIZyh8p+zGyaKWXaloQ9D5SWJD1BbvdI5qYWuKk2I5pscOJ5iWdtt4icwHS3LGfKZukfiKN28F1M7cWQAwlMoaD7M8YlOgpWOcIwh4VnOUwGk5Gv4JwVhYJK/6yVSmnGiAcqIGXVTGIJHo1TtHnT66LzPbd5jQjjXlrvUJud8IZLnPJ8X899fxJiV2+hjIedRZxlwcXutQQgVyDJWkFzk1aRsPGK8jXgH1RRrvE5wM5r3JUeobfA9SK7GlpceRlp+oXEl/zPZKW808/zYykOuWIXFrIEJjTGmgOLKgZM4byf4GAYpu87Jf2mAmKcySxbqXB8JqmWfoF62dlop7TuGuxbx/R0lYjJze+qzcZonI+EhQSVAJ8XZ1twkkT2jZZfEeMvy90yzRZCv0CryzMqOzGtE2qZTm70cNN2Z9zs3GeSCFxZI7j3Il4/YlYR6eL0A4yccjV/Y8sTUXzeHT9Hq/iV4I5Dr0tz0LrNe0Ctit20YzqNXOo0xasTCvLrCTDjhPCSFAamLTvrhyHw2xwuY2VrmjxdlKM6xozrnOrvpc0kL2RwI8OfJJT1BaoiOHvxMG9G02hbZWfzyY/kAdDyJuHErIQlvdLXcX9Agn5YN1kTl23UBA4On93bxazFWGvxebm3dbgAQcmFYc6fBm7vkwtgiao4JVd653zJE4Q/1cJPE13DrSUnJBO2jz1Mc85wXVX94EWS5us2ZryLdXEujd3QWCvOgiA0Lso6jW91H2S491S4kTXS2BejBdiUqslqX8ZiIngA52XaQoVtCBIomzzc2enBqExGC1oZ3sklIrPqzlAOVpVjJ9pevzrtRxCaepNutQHVXeU2mWk+FavhBbiGVupsEWmoC3ozm3ctwjs390glls4iXCtbfGh9IJihHx88Ovnz86rcIbJBIar5a05h00elo2Zs5ajfe5laI+6BoV6E2wiWnww4mCgQi3jXmMbvVoiDRkIgOdjY6lkg3KEA09LJxUgqDX49GKMbJpvY8N8285MUpsuIH4ZjMiMTfzKG5DS57MiU/iFqrrQvsOjNZDMlPjm2bFF6uTE5I5393t9CAUEKfJ4eoEI7oiBaZGlUT3gMphDlvw1BwNkuzEpaB3tituK68e6RhYPKnHGl3ZrutjY5GN9enW5nLW4z9gr3NzIc8PKYiHySbHo9+geTZECh+ATXBebpzKXorgBaQv0N8OaiOKIkSicDLqygK7ZpqDhinrMo6MnAAJTZ8WGooaMUWDFuBdqUE2IowEeOHjOzr9lqm4u2VKNIiXV5jdjOSNRPhNQdeOnEY5ukjvSI3q3+Up56zpiWztNosjjuJB53VJwNuyzOsjeZdWgbRmCCd24LGgZzvZj/lbasUjTAz/kYZIHGKWiEuwIfbwMEH+F2zruVUDExYyrSijFmAp6OzLiFjF3IgkikYgVyrn1Ow65knTOJSpT/I8sNQlI/nm/PkjptY6a02KeMB2qiY3UTggemt05kU1G6cbxIWlzQvt/m/0K55rcvDF46spI32VyCsl/IQlzswrlubjnbyliywdurKQAfHtT7OuFDrs3mwQzuRr7pFJaV4EzohZV4s9NhPpUkKmYfNCGKeH6Grg+g2pueyu9k0TDpGOl8HYAzpdgGEJv2LAbv1hGBbM4z13Gn+pKDmNIgLFT2wh1+oz4y2j+JgkQo/iNKA74MMVIuq8tQHYbfHmaolnq47WTJvjzBalve7eKDN0x6ifOHcQ7uJJCimvcsLDjDl2HLQgo8mJIyc8fRYWgu5kG3WXK5M7YKPC/D7zHeffzVR0LixBgUHLW/WUhCN4zX4A4zc8kuDwkSSppSHTLiQALixiKI7pzyoK/FLWV0Q2p+uI1DBuABvW+SuTBhmaNySbKvtEW0qrz1iC6G5ycm+XwhPpHLF77DrPdFEcQdacnHsFvEdwZI5yucFPJ7GVuj33qwbPk64PcKDudWwm6t75dUkSOn7s5Kz+Rn+dhl5n5vNz/XUAxhy9HCwmP9/O4OOj6jcI3sWww38nmszmPF1NwZOmwMmL8EhfVDQSgxjRQiBJrQ9l3XjKjM2YGmFYZlnru3kJlxcoNDLTkOvIlNjVHEYOYtD4UFoE4GEp6ufcmOf8BEJs6gLsLaGHSrZRhXovz5YyL8E5CzZZTpI14QgLJsmWbQt71QTNlwsbcg/ES1GqRmCqiVjbnPTgbkPEuiV3fJrnj8wOth/wMdpSxsVAUs31r7D3RrUkNfghWaqDMoxjzR6sruBaK4jslnWHR02iz25xpwcTaCCCJb774YxsN+rb+Cu8BKTTQP8n6QjlGXN8o3LUW/ER3Q/kme/efN38XQmOcV2A4DuFjXB8F7TWqb1I2zImAmbDthpXk1kGEwfNzzoqKpy5trvlVIrVxbRvFCmW1ru7sivnOhAhFLjazzLITC5dDxqYjz2s3Di5g6iLsQlX7xl9tEWGZCB7ReN1oCXDTlfQb7P05Ibd6xeSR+ujSiv8bd0mukAwIioWK3Jxg6frhVgvoc5IwrLC6S1x5fwdg2jd1qCDFzfwcinrXe/mN4YU4r3MifBsnSMnNQpXXGb8qlLdc6kHemG1u7CbyVjYg+P4aRLDiMV5m3tB576HP9qn3Hqy/tEmcTZ/69dPVtRdq2E62sAKypoYdNdm3k1sgEf2JUTLlEIPI+c5gqq03jVUpp3uXfbL8hWZC5q5zRnjiXNH8JOdtWDgTwNPqU2tQypgeK/QlnQ193UyrFCzopuxjpmfORuRLDHx0mZR9bWv3caKUYUi1Y3lFvTpqBEHJ52DIAb4RjFIjz99sckRAEvF/1x/UG/ny9Js9VJkMtklxBq69Jr2UFChK0bTz9hNLU3yH+lQ440TRhw8Nb8wsDUSnUYUdd/QIx4VWORc/1wWozq4jobjP6Oua/da4G0TuqLsYnU0N7J7G5Xu56pExxla7q3pQZYmwABdU2d6X9BBEZXZefxJPWrZ95XaxcqN25/vITwsFOrRoAOeZLZ1gBgFEyvbRfYk5BtWRqOPiqB7en7ezSMM0fxv2XZG4hhbTyvKTAnZklxXErukrcXugtp5TVuRqASSnZ4PjdeNxvsWcYImnQtfc65bP95rqgPuX1KtHmYZGbXxZmQamGgstMhrSsbG+o69Lm8cVf+9n/NBEAaYO03WtyLj1umhyNX1YYs1et/6xanrHvizU7hxWJy9S/VhaTbNMWaaEkSOByUK1B+tV5m8v30UzRP3ZqcoT9CD9PYaRq4Ggc6BoEu9xn+Q/phmas0i3zcIfpvBmjNPKbILwoNTkQ1y6yL1nLU3h/lNvwfL4uUWnDc3Casr3CbeOdkUcbL+XrwVno05NJlAY5QHqmuSrUWU+Jd0oaXXFFStJgDCTAa3cEuQv1iS5DyeVHn11+jTVYy4nOnsENRCSvQPUTlkdooiJw1sGWuSSrz5sAdrsWLRYHKuT94adkfKo3OTOW1yycNFiBlPEIOHbh3YIB9XCt5Df7c8Enln6iCH5dlWzC4NZE5GidqAyLHpB/X34X/ZzfvZyHNlPyZlo5j6pujUIKLwKJGLrdefjV3I2ZNLRxFNUEDPzew8xbvF02kUjk1kRt5JvhG+iu0au50xOTpFHXde08qS5gJImeiNCuI76xmLvWQSZBp/GezaB3Y9dZkPvQa6EUvfajceRGsGK+1+h7I3ch3eK+Cp481Epjfb8xB9ke3QZrRwatDS0qF7KWfSZxntbbR5IhT47gZ1H2f3D7t+TBKgINHRiO0/qbaCSLI8Thg6s1hxyo0gBIoLXlISfGu2mLQCYak8ObPTws84r/udKeO9JticbAoqmz3J++ZEZ4YqOLmT7DZca8PiwcZwnSKQYFJcr3UseyZ2bjIS6UeN0Bl0ERK1KtsHxcWJBALnkG/KPQnFf/87E52hssmto9s2rbuImwYD5CM5Yn522bxb/kojiNH6VoGjLjhG5bGmEUezDCp4IUT3OwKgCNDMl4AvLk2A5MQ5+soxN7wLum9TKEsjG4IZWaTqsAE3eHwyeqezPToM9azwvblCiJggRsfoFHS1G88Z4g92fPz7x4zQrx/fFMWW6pORW5f8ODDJEpGSQDhvo7UssDTwcJKqZyMo5zSdmYN754lAG9aH2eIo1nRI0hn/QkbDw6NESlKvafVT86Ipy8ehQMX6MYP0wd0Sl4DYSU/N450LdPSmJGbLXCyfQDqjIa1E1fts6HqURpu2J07qaraDkRuyd03zqoJvl0iL7mZkCX5s2jQx98K2XtJYOiYezDqdbHs9u4Q6glRiPkB8Y0gCDzeaVXUFoH+EKGDihTrr2bI3RDCK1M/Wm8K9PogE/Jgsl+gLzRyFvVANqVvC7NEpl6qMdBu3GHTrL4AQnX7SijljqdKgOTGfxQkO1kUBsdHZXldrI7FbrBNFidCgtwdpLBnm+D4lSj1LGO/EWPrgyANScUk8LJo5R+c/saQIrkkIx2FAJrtczx3xiJMsRMhm3HTcIHuHhLrvmxn5jBOeumhems7mNZ9Ip7G5ng/ZcvRc8126KllDa8It1HckupqoZNEDoTDFhW2i5mnHeJc8IM1jf6fWX2aew0+msYK6lOudqfapdKeRbH91nCB+jOmdNB74GMErKZhql25C6g58cDIlJorAeCzK/yrNnAWsn5UJFohp13N4QFq11nHdj7rF3yhgCNt6bdJpFXkNojzpZo3j4MTqxf7BxogSB2Ub9uUeYpIy3IGKpTc7D868WTyFPIPOavWNWcYCHlvPPeBT2BA/7pJi9oOcTQQAdQqgpsbnOc2E4jgOej/0rSKRxxwrNyR6mvaG59FGv9FqKdFKU6YDSiA/FvUoYTualDZ3jvcwcMfAc2xiLG4ORqsmWoHwdgxy5qH76p6gI1E8nPo0C7pxn6EKLDwQOYuMa2A0Pf2jn87jFbmV5oh7gadLQedOv672tATCswCEsdiRApxwG15dlKmzq5ZdmzHMKRxBilEnfjJaSMRZZCYRk37pZOJxUdXx0Cn+js5cSYTGytb0o0F3dOl0M+sIHQFeJKxxGMlUkwkQekNr8jBnJq9g7YJVvTF5p4pN1bf8k2Y4GB2i8zD0E0tHYFnU5PazubxrRxmlfdbTGY5XLnFYatYUFhzFurFhQfeA5EcUGAv6bHooXX8A35/M7KcxqbSTWY/phK/pnIhlDCjpTdSymeaVVJkBXBGA/HDiwHQs5DCdSUM+HnQAC1NNoibQ5ZCmgzlXX5zmKyYtifAk/8bVp8ygO5vJBhO0TYrGogvP5pUYK3P2A6FqzOr+aNlP3OvYLpgK9aAiBQQp98prTZV8XNZiAw8pYgUMMMUpP/teqF9K9sM4yXtqNrItynZVJt5X3FStKYhyUnSNQ3W0yQv0OWA6Hsy2ecRgbHblkc1LyeTjlZkuqgN/6JPlepCpa+6H9qrJlP3LWN8YiYmjyWNEbQ5rcEig4p43lBE9yqbMgihxG9xLRX2inYOR0FOzxiRfjKRY2y5jv7F8ASuIGg1xY5xbW7vYrfiyEH4OemDPPBvnPLzPgj7jFEjoYERRukYHmz2P3I8VyMFiOGtbBBM9HY7nGobxGvSCNeHNnsNbt5313rMlW7Lr5Po6aPxb+xeOa6cced+6Yrr5XnbNOKGCBxbxPdEMtKF+/ZpCkBjzo4/cMlsHfZAFR0H/WSDo2hebpcGSKSkZFLTA8Z1b9Hu/zncyszIa+QUDwpA40QTwQDTgZj0oB/5Jf3fEjqOCC0GHSFag0ICD2AYXR5fK0+d7wpV5tnhDInxS0OsOrwuOloWoJPcGnX3nnbMDWJKTy0ca0mLQ+V7UpTjgLW8MeiDvjt5sGPx184dcJNm1lv3C7QRhdszY6Qq6X6ZoSbjEqpeuJWo/kbMVvE1gGn7cURuQSqN3PdCETDmnBf1KuewFhp8z/+y5qUFF08hojNTfn/E9fCzaue7TXhAoD3i0+95VoaHWiVw+7Igl09KgESpBrk3Hy2XaGvRY3tndOGOYHTRpWsZLuJt++rjoMuZtDDcnEcalwX/R2XTp+gDULcLhXTTEsCjdY/+ljzOgt4Rkg6fzJFL8JE0wEEVkgj+MvkI69JuY7+W5451L3Ulo51PS7Zls/AvIHwluboQy9/Ga66KpO33XkNTghUVJKRTTYlUVxT8wi5XLJW+902OSJRPr/Dd8Wr67pTFu0TmzTrJaZvYxeNfBcl8rc3Fqow1sqCe72fhIzaBzXg8b2wz/cDveo7rRxGJyD2/Rph9QNGwip3+3u+eB8+1DYo2jw5T4OqyN6fBJn43AGQSY877vMKF+axcplm4MrFCl4eNbWNholhU55tiXrcd7aZm/eCDnCb06TalbYn11xgr4Vacv2ttBwzWWWzfJcnhU3XSXoB8eR0egc6EKwMnxK8xwKP7vD241z0FC5QYf2AwzHvA9XUDwi54MOgFXAv1RL3ftsgIVAfbdMWPeOXYOOzVutSe4dVcCu3k1J3c83xf80Uk3oTpLaEveuqA0nsyM0+v2o4N+t+xpEZsa05vZQ7hruiOhuMi3fOkALFe/6LrXJQclK5J0dy+LNGqbu9nxrol5Tr0uLyO6WdCpyreJNnJ1is/OHaZwLjQoTrQqCTikneAa8L9R73YPWFdhb9Dtw/maw6pWWgT/1PVHHwMSgK0+NxJK1tD7ZLPssv/9nYhzyvTq5D7PPaxpWX00y6ClURNyk+W+PAxCE5DSCmfiW+ekOZ6v851ezNCbM+8F2gSlfgRrS/3yLKeBN5nvhfR80F1sobfo2xLg4U73SL32He/u1yJ3Q4OVEzuiPvDi2ARaSGtABnZKP7jt5wgnfUtULXMv2iRRMXV/zgOjSXQVnkgZv5MK1NsPcoYRNvfdktok0nAXOTzc8HqRnAruK7b72mhSTEa9T1bMHEu046geMIcWU2xx5VpP1nhNTwa904YyrkP5JUghmuVQ2DsdPqa9IRdvCm2m2BnJdOFSv545mNUcovd75wgWR3RHltOUHSJlBBB3e7cBISLRfNKxNw9PfVogPPXD5fDmV+ef8A4ee432ihzu+bGeKBISJHHWYfxAIvePvViayKsBKA0N01GhxPvhQnVliCID3sR9WUegbTJ16dqis7nVgw1h8h8Net0PJqaRbPgVzO0AUKGq03RkzvxrqC2Yocm8upXAi056xfIlBDFToLiGVLJxiJ7VgVb6jwjYW947tNcXth0O2bvw2ulbtws2tvmRaoJIUt/kBkChk+h8E1672ZRtgGaZiiYjS7+7sor308JxFL73UZ4TEiUbEwbiznZa7Oul1mqy7gYJLOln2hXVSd4YnvO+EYJuk08muk2tGuNfnVjF7Psg48XmnxPHEDXJv074XXhU9I2VjCFuqEvnsFsbUmtWALeLuzgbJ6XJ39AZriSz1IfJJlw2gx/jLheO2yXzfmTQP3pd/FMvmTVCKXjm+FQMI77zRocun1MPzS9rfmLTHoA9O2pVVooa8mLkPXCwaR0fzN45wwzsSBGTXXnFcjNCzBoNmqFswkjXhsi1u1PexKnZ7d/mZgT1tWlbPT2gLoGpBcfP/qghLtl/MHvHBIgo4jzui/w63bfvc+qTVOZrTgJwmo56OrU8oAGX7yq9cGT5AWl0pKzpLA8xI9hQsbBYjrHH0urDE63gOk7KdjE8vdmdeniYpv7K455I42l8PbXRYOo0Ir5sOzr1aMwDEilAQTXPGz1rDgtk22dz+vt9+ZTU48Ek7ClhYlbwz9Mf9KLuZJz8q2J7AoxEhuZtNJha7DJsdRrGgSWgITMiVkbBLUBsPHcwe504tMvi4F+tA0BxivqJwxM5puWDBUjWTOfX8f7Mi6Nrp/42pi5prqmN96Sh89GmlqOrG826Ex5sNgkDtFlO31nU8CrfTzxPOBQA3xg/DJ+C9ZKbx+jrtWO7JJo/c46CyMe0lkzJusxOPktZdjKeZ7jGu3v6uXkXTUbKWeAL5VOD7EHFZWdPF4PYvx+FaWiM8Qr6/gKo2PHrMsXlmHljbWRxcaGuUGMr0jlbZlfiWAKbheDkQgVUWSqZr/UAhKkaTTNgVEpy6YNpvEgQr37LM4mwdZPpoIupYNrt7tpwJkeNjS22ttk/4fDTwKmJkZjd+ObCI5kNfiKwuVPN5ULyH40WAEPQ8tOrTt+LbzGnkgcCh2lCOINx0xMKskjvf5+6FCcNUYF1M2BvZnFec83lEjHF+HAGrCmejiZu++jhXqQofwV9d9TDda/T/QU8LZKPOflayyHKHLRWWxw8r7ELuu4dWU8yg37gUIcWDwZw9nSvj8H5j+GnLBJDdPEV9P1Bb21RuXFAnksVPngxIP2/TT3lXgMIz6MpkUCzoeYEVLJE0+aeVftaY13qUJwMVPOUD/ZExbwJr87qZ1Tu8KithzhGanLeBRQfo8m76Dw/L42DWLm9+cf51677W1M7MB2oNTicbuKuo4n63tL8NuZGS27SGPEXUPK3Bt0Lis31Jb1P3eZn7HUKFvO9zSiDzhlGp5Fy6NfrrzzeS4H3LFkzkHVK7IWXLF3b7I1b1AOYzrSTfe30v/SVbM4fG2Hkn9OzFCZBkt3c19dGxTbB+IvQ8NcGXb4c7JNS/RY5XklMCIpi5mGnNiCaAOpFXfpLj3dOHJcRO53bwaFM8g6ZzmYkeVcuU2gKvUuf4mun/6U7ncbNCbYzlHUF9tw4sTL3nHOdroaaMcKLDpJf41K8dvrfudPtVQif0Dc4mE5ZHqCDBvKINtl4lJhrIC4FuzDp1Qb5NtVcsA4bALl0p+iEoerpOm40plcX5Nu8vNl+sNeR5grl6J1mfJD6FtPrmP9GQff0F5i8jEevf1FMyz5JjBpfd/s3CjotOjWbzGOg1M0oMqaJKiP0vNyLzfJtXvA7jc2oPXIWzsymgPbsAw1k3Cvm36iag4uExtzmRM/FMMdoNBCBE4pfadw3Cjp58XTzdR0sYWaSRqc51N5GpbzC/k2O9yCjG/OM925u/ow+TI/BLiRMulf6/m3udNihJE2E631wN71C0RQEuVbgDPAvsdE3CTrzs6CJcGOOM6tcaQod83cCNC9E7htl7+LPTnbAX/8qcNCb1yRQ9mhej+ubBL1p1YLsvCcykFvQIZKZaE8RknMvCs13esnkjXPoYUhvRjSFGV5HSSFmv74oNN8r5oGTk+g0ln2bcISUjqOmjvCed+EV9O8XdOrXaDQkg/4Cx7F6/HOeEgbFpted/m3udHnDY4yZt5HuFnTwqWDgCtVD5kzGV/b+TYJ+G08KN3cOB4NdeoAzP8eLOt/z1A8vcOYbvpLu78PgMcYsmUV2oHSdUrXX8f4Nr3anUennidJROibDtJtT7Hqf3I/XM/qGQYfQcaTDKPI2zWjmKEGOhH6pCr/jPg82NhAGMtAyy7vdefd2vIzu466/r9f/uaB7G6NpBrFOFCnMI8AIp2P+zWjH1+uvTuM5UahucNlMcf4lgl5SQtDfXPdCZ75h9q7hr5z3ium5AORAl4kdmNCD795fx/t32+mOk2TJmzjIaLJNzIRNyXF8eXd+w6AnWMY5WMNl+oKDMlHz+YKg9+fjOKUXNfLbvqIGIsqpAN6NKfp+oCnF63j/tml80Lws0GUCxwF1wGwO/et0/9YFO8e74VpPtKuptRrp769n862DHnCtY5IjHMNiSn6qQU8vcOYbp/Gcyz2eLvVaLxxI6zpoHtxLzPatX74d8Jqe7Tt35PCP15P5pi9MvUWgBzq+kwZdg362Iu71+p53uk0czyJPYeyLC248jG+vIRvfea97TvnItJjzzmMmzIgF8NKyff/Yc4guZmsAfT+e+9ed/g9kcxPJUw6z3uVD8irZ/oWCfWDrJb6C/g+9Egf69d53iUF/PZF/4FJPHG+Ny9y9gv7PHO/EaE5I4V9B/1eiXuty///qy8dU//dlDPx6vV7f+Wa3Df6C416v1+v1er1er9fr9Xq9dr7+Px5ifd0zSYk6AAAAAElFTkSuQmCC";

/**
 * generarReciboVenta(numeroVenta)
 *
 * Busca la venta por su N° Venta en "Ventas", completa Color desde
 * "Compras" (vía N° OP Compra) y los accesorios incluidos desde
 * "Venta Accesorios" (vía N° Venta Celular Asociada), y arma el recibo
 * imprimible (una hoja A4) con todos esos datos.
 */
function generarReciboVenta(numeroVenta) {
  const numero = String(numeroVenta || "").trim();
  if (!numero) throw new Error("❌ Falta el número de venta.");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ventasSheet = ss.getSheetByName("Ventas");
  if (!ventasSheet) throw new Error("❌ Hoja 'Ventas' no encontrada.");

  const fE = 2;
  const cNV  = getCol(ventasSheet, "N° Venta",             fE);
  const cFV  = getCol(ventasSheet, "Fecha Venta",          fE);
  const cNOP = getCol(ventasSheet, "N° OP Compra",         fE);
  const cMO  = getCol(ventasSheet, "Modelo",                fE);
  const cIM  = getCol(ventasSheet, "IMEI",                  fE);
  const cCL  = getCol(ventasSheet, "Cliente",                fE);
  const cTL  = getCol(ventasSheet, "Teléfono Cliente",      fE);
  const cPV  = getCol(ventasSheet, "Precio Venta",          fE);
  const cEF  = getCol(ventasSheet, "Cobrado Efectivo",       fE);
  const cTR  = getCol(ventasSheet, "Cobrado Transferencia",  fE);
  const cCU  = getCol(ventasSheet, "Cobrado Cuotas",         fE);
  const cUS  = getCol(ventasSheet, "Cobrado USD",            fE);
  const cOB  = getCol(ventasSheet, "Observaciones",          fE);
  let cCUIL = -1, cOP = -1, cDOM = -1, cEML = -1;
  try { cCUIL = getCol(ventasSheet, "CUIL Cliente",       fE); } catch (e) { /* columna opcional */ }
  try { cOP   = getCol(ventasSheet, "OPERADOR",           fE); } catch (e) { /* columna opcional */ }
  try { cDOM  = getCol(ventasSheet, "Domicilio Cliente",  fE); } catch (e) { /* columna opcional — puede no existir aún si nunca se cargó ninguna */ }
  try { cEML  = getCol(ventasSheet, "Email Cliente",      fE); } catch (e) { /* columna opcional */ }

  const lastRow = ventasSheet.getLastRow();
  if (lastRow <= fE) throw new Error(`❌ "${numero}" no encontrado en "Ventas".`);
  const datosV = ventasSheet.getRange(fE + 1, 1, lastRow - fE, ventasSheet.getLastColumn()).getValues();
  const fila = datosV.find(r => String(r[cNV - 1]).trim() === numero);
  if (!fila) throw new Error(`❌ "${numero}" no encontrado en "Ventas".`);

  const fechaRaw = fila[cFV - 1];
  const fecha = fechaRaw instanceof Date
    ? Utilities.formatDate(fechaRaw, Session.getScriptTimeZone(), "dd/MM/yyyy")
    : String(fechaRaw || "");

  const nOpCompra = String(fila[cNOP - 1] || "").trim();

  const datos = {
    numero:      numero,
    fecha:       fecha,
    vendedor:    cOP > 0 ? String(fila[cOP - 1] || "") : "",
    cliente:     String(fila[cCL - 1] || ""),
    cuil:        cCUIL > 0 ? String(fila[cCUIL - 1] || "") : "",
    dni:         "", // se completa abajo a partir del CUIL — ver extraerDniDeCuil_()
    domicilio:   cDOM > 0 ? String(fila[cDOM - 1] || "") : "",
    email:       cEML > 0 ? String(fila[cEML - 1] || "") : "",
    tel:         String(fila[cTL - 1] || ""),
    modelo:      String(fila[cMO - 1] || ""),
    imei:        String(fila[cIM - 1] || ""),
    color:       "",
    precioVenta: Number(fila[cPV - 1]) || 0,
    cobradoEf:   Number(fila[cEF - 1]) || 0,
    cobradoTr:   Number(fila[cTR - 1]) || 0,
    cobradoCu:   Number(fila[cCU - 1]) || 0,
    cobradoUsd:  Number(fila[cUS - 1]) || 0,
    obs:         String(fila[cOB - 1] || ""),
    accesorios:  []
  };

  // Color: vive en "Compras", no en "Ventas" — se completa por N° OP Compra.
  if (nOpCompra) {
    const comprasSheet = ss.getSheetByName("Compras");
    if (comprasSheet) {
      const fEC = 2;
      let cOPc = -1, cColor = -1;
      try { cOPc   = getCol(comprasSheet, "N° OP",  fEC); } catch (e) { /* opcional */ }
      try { cColor = getCol(comprasSheet, "Color",  fEC); } catch (e) { /* opcional */ }
      const lastC = comprasSheet.getLastRow();
      if (cOPc > 0 && lastC > fEC) {
        const filaC = comprasSheet.getRange(fEC + 1, 1, lastC - fEC, comprasSheet.getLastColumn())
          .getValues()
          .find(r => String(r[cOPc - 1]).trim() === nOpCompra);
        if (filaC && cColor > 0) datos.color = String(filaC[cColor - 1] || "");
      }
    }
  }

  // Accesorios incluidos en esta venta ("Venta Accesorios", asociados por N°
  // Venta Celular Asociada) — incluye tanto los accesorios que el cliente
  // compró junto con el equipo como los regalos automáticos que se le
  // entregaron (entregarRegalosAutomaticos_(), Code.gs: mismos registros,
  // categoría "Regalo automático" y Precio Unitario 0). Se trae la
  // Categoría para poder distinguirlos en el recibo (comprado vs. regalo).
  const accSheet = ss.getSheetByName("Venta Accesorios");
  if (accSheet) {
    const fEA = 2;
    let cAsoc = -1, cProd = -1, cCat = -1, cPU = -1, cObsAcc = -1;
    try { cAsoc = getCol(accSheet, "N° Venta Celular Asociada", fEA); } catch (e) { /* opcional */ }
    try { cProd = getCol(accSheet, "Producto",                  fEA); } catch (e) { /* opcional */ }
    try { cCat  = getCol(accSheet, "Categoría",                 fEA); } catch (e) { /* opcional */ }
    try { cPU   = getCol(accSheet, "Precio Unitario",           fEA); } catch (e) { /* opcional */ }
    try { cObsAcc = getCol(accSheet, "Observaciones",           fEA); } catch (e) { /* opcional */ }
    const lastA = accSheet.getLastRow();
    if (cProd > 0 && lastA > fEA) {
      // Plan B si "N° Venta Celular Asociada" vino vacía (columna con el
      // nombre corrido/mal escrito en la hoja real, visto en un caso real):
      // registrarAccesorioAsociado_() (Code.gs) siempre escribe
      // "Asociado a venta celular <N° Venta>" en Observaciones, así que
      // ese texto sirve de respaldo para no perder el accesorio en el
      // recibo aunque la columna de vínculo falle.
      const patronObs = new RegExp("venta celular\\s+" + numero.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
      accSheet.getRange(fEA + 1, 1, lastA - fEA, accSheet.getLastColumn()).getValues().forEach(r => {
        const asocOk = cAsoc > 0 && String(r[cAsoc - 1] || "").trim() === numero;
        const obsOk  = cObsAcc > 0 && patronObs.test(String(r[cObsAcc - 1] || ""));
        if (!asocOk && !obsOk) return;
        const categoria = cCat > 0 ? String(r[cCat - 1] || "") : "";
        datos.accesorios.push({
          producto:  String(r[cProd - 1] || ""),
          esRegalo:  categoria.trim() === "Regalo automático",
          precio:    cPU > 0 ? (Number(r[cPU - 1]) || 0) : 0
        });
      });
    }
  }

  datos.dni = extraerDniDeCuil_(datos.cuil);

  return _armarHtmlReciboVenta_(datos);
}

/**
 * extraerDniDeCuil_(cuil)
 *
 * El DNI del comprador no se carga aparte — se calcula solo a partir del
 * CUIL/CUIT ya cargado (formato AR: 2 dígitos de prefijo + 8 dígitos de DNI
 * + 1 dígito verificador, ej. "20-12345678-9"). Tolera guiones, puntos y
 * espacios. Si el CUIL no vino cargado o no tiene el largo esperado (11
 * dígitos), devuelve "" y el recibo deja la línea de DNI en blanco para
 * completar a mano, igual que antes.
 */
function extraerDniDeCuil_(cuil) {
  const digitos = String(cuil || "").replace(/\D/g, "");
  if (digitos.length !== 11) return "";
  return digitos.substring(2, 10);
}

/**
 * numeroAPesosEnLetras_(num)
 *
 * Convierte un monto en pesos a su escritura en palabras (español,
 * Argentina) para la línea "Son pesos:" del recibo — ej. 300000 → "Trescientos
 * mil pesos". Solo entero, sin centavos (los precios de venta del ERP no
 * usan decimales). Cubre hasta cientos de millones, más que suficiente para
 * cualquier operación real.
 */
function numeroAPesosEnLetras_(num) {
  num = Math.round(Number(num) || 0);
  if (num === 0) return "Cero pesos";
  if (num < 0) return "";

  const UNIDADES = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];
  const ESPECIALES = ["diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve"];
  const DECENAS = ["", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
  const CENTENAS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

  function seccion(n) {
    let out = "";
    const c = Math.floor(n / 100);
    const resto = n % 100;
    if (c > 0) out += (n === 100) ? "cien" : CENTENAS[c];
    if (resto > 0) {
      if (out) out += " ";
      if (resto < 10) out += UNIDADES[resto];
      else if (resto < 20) out += ESPECIALES[resto - 10];
      else {
        const dec = Math.floor(resto / 10);
        const uni = resto % 10;
        out += (dec === 2) ? (uni === 0 ? "veinte" : "veinti" + UNIDADES[uni]) : DECENAS[dec] + (uni > 0 ? " y " + UNIDADES[uni] : "");
      }
    }
    return out;
  }

  const MILLON = 1000000, MIL = 1000;
  const millones = Math.floor(num / MILLON);
  const restoM = num % MILLON;
  const miles = Math.floor(restoM / MIL);
  const restoK = restoM % MIL;

  let partes = [];
  if (millones > 0) partes.push(millones === 1 ? "un millón" : seccion(millones) + " millones");
  if (miles > 0) partes.push(miles === 1 ? "mil" : seccion(miles) + " mil");
  if (restoK > 0) partes.push(seccion(restoK));

  let texto = partes.join(" ").trim();
  texto = texto.charAt(0).toUpperCase() + texto.slice(1);
  // "un millón DE pesos" / "dos millones DE pesos" (no queda "millón pesos"),
  // solo cuando no hay miles ni resto después del millón.
  const soloMillones = millones > 0 && miles === 0 && restoK === 0;
  return texto + (soloMillones ? " de pesos" : " pesos");
}

/**
 * Arma el documento HTML completo a partir de los datos ya resueltos por
 * generarReciboVenta(). SOLO diseño (HTML/CSS) — ningún dato ni cálculo
 * cambia acá, es puramente la plantilla visual. Una sola hoja A4 (antes
 * se imprimían 2 copias apiladas con salto de página; el diseño de
 * referencia es de una sola hoja, así que se deja en una copia — se puede
 * volver a imprimir en cualquier momento desde Mis Operaciones).
 * Paleta: negro, blanco, gris claro y naranja corporativo — sin otros colores.
 */
function _armarHtmlReciboVenta_(d) {
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const neg = RECIBO_NEGOCIO;

  // Línea en blanco DIBUJADA (border-bottom), no guiones bajos como texto —
  // así se ve como un renglón real de formulario en papel, no "tipeado".
  const linea = (ancho) => `<span class="linea" style="width:${ancho || 140}px"></span>`;

  const filaPago = (etiqueta, marcado, valorTexto) =>
    `<div class="pago-fila"><span class="chk-box">${marcado ? "☑" : "☐"}</span> <span class="pago-etiqueta">${etiqueta}:</span> ${marcado ? `<b>${valorTexto}</b>` : linea(170)}</div>`;

  const filasPago = [
    filaPago("Efectivo", d.cobradoEf > 0, fmtPeso(d.cobradoEf)),
    filaPago("Dólares", d.cobradoUsd > 0, "USD " + Number(d.cobradoUsd).toLocaleString("en-US")),
    filaPago("Transferencia", d.cobradoTr > 0, fmtPeso(d.cobradoTr)),
    filaPago("Cuotas", d.cobradoCu > 0, "$ " + Number(d.cobradoCu).toLocaleString("es-AR"))
  ].join("");

  // Los 4 accesorios "de siempre" (recibo de referencia) se muestran SIEMPRE,
  // tildados solo si hay algo cargado en esta venta que coincida (búsqueda
  // simple por palabra clave en el nombre del producto — Cada accesorio ya
  // viene marcado como comprado o regalo automático, esRegalo, ver
  // generarReciboVenta()). Lo que no matchea ninguna de las 4 (ej. un
  // regalo o compra distinto) se agrega igual, como ítem extra tildado.
  const ACCESORIOS_BASE = [
    { etiqueta: "Cable USB-C / Lightning", buscar: /cable/i },
    { etiqueta: "Cabezal de cargador",     buscar: /cargador|cabezal/i },
    { etiqueta: "Funda protectora",        buscar: /funda/i },
    { etiqueta: "Vidrio templado",         buscar: /vidrio/i }
  ];
  const detalleDe = (a) => a.esRegalo ? "(Regalo)" : (a.precio > 0 ? `(${fmtPeso(a.precio)})` : "");
  const usados = new Set();
  const baseHtml = ACCESORIOS_BASE.map(base => {
    const match = d.accesorios.find((a, i) => !usados.has(i) && base.buscar.test(a.producto));
    if (match) {
      usados.add(d.accesorios.indexOf(match));
      const detalle = detalleDe(match);
      return `<span class="chk"><span class="chk-box">☑</span> ${base.etiqueta}${detalle ? ` <span class="chk-detalle">${detalle}</span>` : ""}</span>`;
    }
    return `<span class="chk"><span class="chk-box">☐</span> ${base.etiqueta}</span>`;
  });
  const extrasHtml = d.accesorios
    .filter((a, i) => !usados.has(i))
    .map(a => {
      const detalle = detalleDe(a);
      return `<span class="chk"><span class="chk-box">☑</span> ${esc(a.producto)}${detalle ? ` <span class="chk-detalle">${detalle}</span>` : ""}</span>`;
    });
  // Las 4 opciones fijas siempre van en una sola línea (chk-fila-base, sin
  // wrap); si además hay algún accesorio/regalo que no matcheó ninguna de
  // esas 4, se agrega debajo en una fila aparte que sí puede envolver.
  const accesoriosHtml = `<div class="chk-fila-base">${baseHtml.join("")}</div>` +
    (extrasHtml.length > 0 ? `<div class="chk-fila-extra">${extrasHtml.join("")}</div>` : "");

  const campo = (etiqueta, valor) => `<div class="campo"><span class="etiqueta">${etiqueta}:</span> <span class="valor">${valor}</span></div>`;

  const html = `
  <div class="hoja">
    <div class="encabezado">
      <div class="encabezado-izq">
        <div class="logo">${esc(neg.nombre)}</div>
        <div class="direccion">${esc(neg.direccion)} · ${esc(neg.ciudad)}</div>
        <div class="direccion">Tel: ${esc(neg.telefono)}</div>
      </div>
      <div class="encabezado-der">
        <div class="titulo-recibo">RECIBO DE VENTA</div>
        <div class="dato-header">N°: <b>${esc(d.numero)}</b></div>
        <div class="dato-header">Fecha: <b>${esc(d.fecha)}</b></div>
        <div class="dato-header">Vendedor: <b>${esc(d.vendedor) || linea(110)}</b></div>
      </div>
    </div>

    <div class="seccion-titulo">DATOS DEL DISPOSITIVO</div>
    <div class="dos-columnas">
      <div class="columna">
        ${campo("Marca/Modelo", `<b>${esc(d.modelo) || "—"}</b>`)}
        ${campo("Color", `<b>${esc(d.color) || linea(140)}</b>`)}
      </div>
      <div class="columna">
        ${campo("IMEI", `<b>${esc(d.imei) || "—"}</b>`)}
        ${campo("Batería", linea(160))}
      </div>
    </div>

    <div class="seccion-titulo">ACCESORIOS INCLUIDOS</div>
    ${accesoriosHtml}

    <div class="seccion-titulo">PRECIO Y FORMA DE PAGO</div>
    <div class="pago-box">
      <div class="pago-total">
        <div class="pago-total-label">PRECIO TOTAL</div>
        <div class="pago-total-monto">${fmtPeso(d.precioVenta)}</div>
        <div class="son-pesos">Son pesos: <b>${numeroAPesosEnLetras_(d.precioVenta)}</b></div>
      </div>
      <div class="pago-detalle">
        <div class="pago-detalle-label">DETALLE DEL PAGO</div>
        ${filasPago}
        <div class="pago-fila pago-comprobante">N° comprobante: ${linea(200)}</div>
      </div>
    </div>

    <div class="seccion-titulo">DATOS DEL COMPRADOR</div>
    <div class="dos-columnas comprador">
      <div class="columna">
        ${campo("Apellido y Nombre", `<b>${esc(d.cliente) || linea(160)}</b>`)}
        ${campo("DNI", `<b>${esc(d.dni) || linea(140)}</b>`)}
        ${campo("CUIL / CUIT", `<b>${esc(d.cuil) || linea(140)}</b>`)}
      </div>
      <div class="columna">
        ${campo("Teléfono", `<b>${esc(d.tel) || linea(140)}</b>`)}
        ${campo("Domicilio", `<b>${esc(d.domicilio) || linea(140)}</b>`)}
        ${campo("Email", `<b>${esc(d.email) || linea(140)}</b>`)}
      </div>
    </div>
    ${d.obs ? `<div class="obs">Observaciones: ${esc(d.obs)}</div>` : ""}

    <div class="seccion-titulo">GARANTÍA</div>
    <div class="garantia">
      <p>El equipo adquirido cuenta con una garantía de <b>${neg.garantiaMeses} (doce) meses</b> desde la fecha de compra.
      La garantía cubre únicamente fallas técnicas de origen no provocadas por el cliente, incluyendo problemas de encendido, fallas internas de pantalla,
      batería defectuosa de origen, fallas de software persistentes, problemas de carga, audio, cámara o conectividad.
      Toda garantía queda sujeta a diagnóstico y verificación técnica por parte del local.</p>
      <p>La garantía NO cubre: pantallas rotas, fisuradas o con daño físico; golpes, rayones, deformaciones o daños estéticos; daño por líquido o humedad;
      equipos abiertos, manipulados o reparados por terceros; daños ocasionados por accesorios no originales o uso incorrecto; problemas relacionados con
      cuentas, contraseñas o bloqueos del usuario; daños eléctricos externos; fallas posteriores al vencimiento del plazo de garantía.
      Si el equipo presenta evidencia física de golpe, humedad o manipulación externa, la garantía quedará automáticamente anulada.</p>
      <p>En caso de ingreso por garantía:</p>
      <ol>
        <li>El equipo será evaluado técnicamente. El local dispondrá de un plazo de <b>48 (cuarenta y ocho) horas hábiles</b> desde el ingreso del equipo
        para emitir el diagnóstico correspondiente e informar al cliente si el caso encuadra dentro de las condiciones de garantía.</li>
        <li>El local determinará si corresponde garantía según el diagnóstico realizado. Una vez comunicada la aceptación, el local dispondrá de
        <b>96 (noventa y seis) horas hábiles</b> adicionales para llevar a cabo la reparación o brindar una resolución definitiva. Este plazo podrá
        extenderse en casos de fuerza mayor, tales como fallas de placa, demoras en disponibilidad de repuestos u otras situaciones excepcionales
        debidamente justificadas, de lo cual se informará al cliente oportunamente.</li>
        <li>Si corresponde garantía, el local podrá optar por:
          <ul class="garantia-opciones">
            <li>reparación,</li>
            <li>reemplazo del equipo,</li>
            <li>o devolución del dinero abonado.</li>
          </ul>
          La devolución de dinero será siempre la última instancia luego de intentar reparación o reposición.
        </li>
      </ol>
      <p>El cliente declara haber recibido el equipo en correcto estado de funcionamiento y haber leído y aceptado las presentes condiciones de garantía.</p>
    </div>

    <div class="firmas">
      <div class="firma-col">
        <img class="firma-img" src="data:image/png;base64,${RECIBO_FIRMA_TITULAR_BASE64}" alt="Firma">
        <div class="firma-linea"></div>
        <div class="firma-label">${esc(neg.nombre)} / ${esc(neg.titular)} — DNI ${esc(neg.dniTitular)}</div>
      </div>
      <div class="firma-col">
        <div class="firma-linea"></div>
        <div class="firma-label">Comprador — Aclaración y DNI</div>
      </div>
    </div>

    <div class="pie-separador"></div>
    <div class="pie">Al firmar, el comprador declara recibir el equipo en conformidad con lo descripto. ${esc(neg.nombre)} · ${esc(neg.direccion)}, ${esc(neg.ciudad)} · ${esc(neg.telefono)}</div>
  </div>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Recibo ${esc(d.numero)}</title>
<style>
  :root { --naranja: #E07B1E; --gris: #D9D9D9; --gris-texto: #6B6B6B; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; font-size: 11.5px; }

  .hoja { width: 190mm; padding: 4mm 12mm; margin: 0 auto; }

  /* ---------- Encabezado ---------- */
  .encabezado { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 8px; }
  .logo { font-size: 26px; font-weight: bold; letter-spacing: .3px; }
  .direccion { font-size: 10.5px; color: var(--gris-texto); margin-top: 3px; }
  .encabezado-der { text-align: right; }
  .titulo-recibo { font-size: 22px; font-weight: bold; color: var(--naranja); letter-spacing: .5px; margin-bottom: 6px; }
  .dato-header { font-size: 11.5px; margin-top: 2px; }

  /* ---------- Separadores naranjas entre secciones ---------- */
  .seccion-titulo {
    font-weight: bold; font-size: 12px; text-transform: uppercase; letter-spacing: .4px;
    margin: 11px 0 7px; padding-bottom: 4px; border-bottom: 3px solid var(--naranja);
  }

  /* ---------- Filas de 2 columnas (dispositivo / comprador) ---------- */
  .dos-columnas { display: flex; gap: 40px; }
  .dos-columnas .columna { flex: 1; display: flex; flex-direction: column; gap: 7px; }
  .dos-columnas.comprador { position: relative; }
  .dos-columnas.comprador::after {
    content: ""; position: absolute; top: 2px; bottom: 2px; left: 50%;
    width: 1px; background: var(--gris); margin-left: -20px;
  }
  .campo { font-size: 11.5px; }
  .etiqueta { font-weight: bold; }
  .valor { font-weight: normal; }

  /* ---------- Líneas en blanco dibujadas ---------- */
  .linea { display: inline-block; border-bottom: 1px solid #1a1a1a; height: 12px; vertical-align: bottom; margin: 0 2px; }

  /* ---------- Accesorios ---------- */
  .chk-fila-base { display: flex; flex-wrap: nowrap; justify-content: space-between; gap: 8px; font-size: 10px; }
  .chk-fila-extra { display: flex; flex-wrap: wrap; gap: 10px 24px; font-size: 10px; margin-top: 8px; }
  .chk { white-space: nowrap; }
  .chk-box { font-size: 13px; position: relative; top: 1px; }
  .chk-detalle { color: var(--gris-texto); font-size: 9px; }

  /* ---------- Caja Precio y Forma de Pago (protagonista, bordes rectos) ---------- */
  .pago-box { display: flex; border: 2px solid var(--naranja); margin-top: 4px; }
  .pago-total { flex: 0 0 34%; text-align: center; padding: 10px 14px; border-right: 1px solid var(--gris); }
  .pago-total-label { font-size: 11px; font-weight: bold; letter-spacing: .3px; }
  .pago-total-monto { font-size: 26px; font-weight: bold; margin-top: 8px; }
  .son-pesos { font-size: 10px; color: var(--gris-texto); margin-top: 8px; }
  .pago-detalle { flex: 1; padding: 10px 20px; }
  .pago-detalle-label { font-weight: bold; font-size: 11px; letter-spacing: .3px; margin-bottom: 6px; }
  .pago-fila { margin: 5px 0; font-size: 11.5px; }
  .pago-etiqueta { font-weight: bold; }
  .pago-comprobante { margin-top: 8px; }

  .obs { font-size: 11px; margin-top: 6px; color: var(--gris-texto); }

  /* ---------- Garantía ---------- */
  .garantia { font-size: 8.5px; line-height: 1.4; text-align: justify; color: #2b2b2b; }
  .garantia p { margin: 0 0 5px; }
  .garantia ol { margin: 4px 0; padding-left: 18px; }
  .garantia li { margin-bottom: 2px; }
  .garantia-opciones { list-style: none; margin: 2px 0; padding-left: 14px; }
  .garantia-opciones li { margin-bottom: 1px; }
  .garantia-opciones li::before { content: "○ "; }

  /* ---------- Firmas (al pie, líneas largas) ---------- */
  .firmas { display: flex; gap: 50px; margin-top: 65px; }
  .firma-col { flex: 1; text-align: center; position: relative; }
  .firma-linea { border-top: 1px solid #1a1a1a; margin-bottom: 6px; margin-top: 85px; }
  .firma-label { font-size: 10.5px; font-weight: bold; }
  /* Firma de GreatPhones ya estampada — apoyada justo sobre su línea, ocupando el mismo espacio que antes quedaba en blanco para firmar a mano. La columna del comprador no lleva imagen: esa firma la hace la persona presente. */
  .firma-img { position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%); height: 95px; width: auto; }

  /* ---------- Pie ---------- */
  .pie-separador { border-top: 1px solid var(--gris); margin-top: 8px; }
  .pie { text-align: center; font-size: 8.5px; color: var(--gris-texto); margin-top: 4px; }

  @page { size: A4; margin: 4mm 8mm; }
  @media print { .hoja { width: 100%; } }
</style>
</head>
<body>
  ${html}
  <script>
    window.onload = function () {
      window.print();
    };
  </script>
</body>
</html>`;
}

// ============================================================
//  Recibo de Preventa — mismo patrón que generarReciboVenta() de arriba
//  (documento HTML autocontenido, solo lectura, window.print() al cargar).
//  Reproduce el recibo en papel "RECIBO DE PREVENTA" (seña + saldo a
//  abonar en la entrega, condiciones de preventa, garantía desde la
//  entrega efectiva) — mismos datos del negocio y misma firma estampada
//  que el recibo de venta (RECIBO_NEGOCIO, RECIBO_FIRMA_TITULAR_BASE64,
//  numeroAPesosEnLetras_, extraerDniDeCuil_, ya definidos arriba, no se
//  duplican acá).
// ============================================================

/**
 * generarReciboPreventa(numeroPreventa)
 *
 * Busca la preventa por su N° Preventa en "Preventas" y arma el recibo
 * imprimible (una hoja A4) con todos esos datos.
 */
function generarReciboPreventa(numeroPreventa) {
  const numero = String(numeroPreventa || "").trim();
  if (!numero) throw new Error("❌ Falta el número de preventa.");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Preventas");
  if (!sheet) throw new Error("❌ Hoja 'Preventas' no encontrada.");

  const fE = 2;
  const cNP  = getCol(sheet, "N° Preventa",           fE);
  const cFP  = getCol(sheet, "Fecha Preventa",         fE);
  const cCL  = getCol(sheet, "Cliente",                 fE);
  const cTL  = getCol(sheet, "Teléfono",                fE);
  const cMO  = getCol(sheet, "Modelo Solicitado",       fE);
  const cPV  = getCol(sheet, "Precio Venta Pactado",    fE);
  const cEF  = getCol(sheet, "Cobrado Efectivo",        fE);
  const cTR  = getCol(sheet, "Cobrado Transferencia",   fE);
  const cCU  = getCol(sheet, "Cobrado Cuotas",          fE);
  const cUS  = getCol(sheet, "Cobrado USD",             fE);
  const cTC  = getCol(sheet, "Total Cobrado",           fE);
  const cSP  = getCol(sheet, "Saldo Pendiente",         fE);
  const cOB  = getCol(sheet, "Observaciones",           fE);
  let cCUIL = -1, cOP = -1, cDOM = -1, cEML = -1, cIME = -1, cCOL = -1, cESR = -1, cED = -1, cEH = -1;
  try { cCUIL = getCol(sheet, "CUIL Cliente",           fE); } catch (e) { /* opcional */ }
  try { cOP   = getCol(sheet, "Vendedor",               fE); } catch (e) { /* opcional */ }
  try { cDOM  = getCol(sheet, "Domicilio Cliente",      fE); } catch (e) { /* opcional */ }
  try { cEML  = getCol(sheet, "Email Cliente",          fE); } catch (e) { /* opcional */ }
  try { cIME  = getCol(sheet, "IMEI Solicitado",        fE); } catch (e) { /* opcional */ }
  try { cCOL  = getCol(sheet, "Color Solicitado",       fE); } catch (e) { /* opcional */ }
  try { cESR  = getCol(sheet, "Estado Requerido",       fE); } catch (e) { /* opcional */ }
  try { cED   = getCol(sheet, "Fecha Prometida Desde",  fE); } catch (e) { /* opcional */ }
  try { cEH   = getCol(sheet, "Fecha Prometida Hasta",  fE); } catch (e) { /* opcional */ }

  const lastRow = sheet.getLastRow();
  if (lastRow <= fE) throw new Error(`❌ "${numero}" no encontrado en "Preventas".`);
  const datosP = sheet.getRange(fE + 1, 1, lastRow - fE, sheet.getLastColumn()).getValues();
  const fila = datosP.find(r => String(r[cNP - 1]).trim() === numero);
  if (!fila) throw new Error(`❌ "${numero}" no encontrado en "Preventas".`);

  const tz = Session.getScriptTimeZone();
  const fmtFecha = (celda) => (celda instanceof Date) ? Utilities.formatDate(celda, tz, "dd/MM/yyyy") : String(celda || "");

  const precioVenta = Number(fila[cPV - 1]) || 0;
  const totalCobrado = Number(fila[cTC - 1]) || 0;

  const datos = {
    numero:          numero,
    fecha:           fmtFecha(fila[cFP - 1]),
    fechaEntrega:    cEH > 0 ? fmtFecha(fila[cEH - 1]) : (cED > 0 ? fmtFecha(fila[cED - 1]) : ""),
    vendedor:        cOP > 0 ? String(fila[cOP - 1] || "") : "",
    cliente:         String(fila[cCL - 1] || ""),
    cuil:            cCUIL > 0 ? String(fila[cCUIL - 1] || "") : "",
    dni:             "",
    domicilio:       cDOM > 0 ? String(fila[cDOM - 1] || "") : "",
    email:           cEML > 0 ? String(fila[cEML - 1] || "") : "",
    tel:             String(fila[cTL - 1] || ""),
    modelo:          String(fila[cMO - 1] || ""),
    imei:            cIME > 0 ? String(fila[cIME - 1] || "") : "",
    color:           cCOL > 0 ? String(fila[cCOL - 1] || "") : "",
    estadoRequerido: cESR > 0 ? String(fila[cESR - 1] || "") : "",
    precioTotal:     precioVenta,
    senaAbonada:     totalCobrado,
    saldoEntrega:    Number(fila[cSP - 1]) || Math.max(0, precioVenta - totalCobrado),
    cobradoEf:       Number(fila[cEF - 1]) || 0,
    cobradoTr:       Number(fila[cTR - 1]) || 0,
    cobradoCu:       Number(fila[cCU - 1]) || 0,
    cobradoUsd:      Number(fila[cUS - 1]) || 0,
    obs:             String(fila[cOB - 1] || "")
  };

  datos.dni = extraerDniDeCuil_(datos.cuil);

  return _armarHtmlReciboPreventa_(datos);
}

/**
 * Arma el documento HTML del recibo de preventa. SOLO diseño — misma
 * paleta/tipografía/1-sola-hoja-A4 que _armarHtmlReciboVenta_(), pero con
 * la distribución propia del "RECIBO DE PREVENTA" de referencia: franja de
 * Fecha de entrega acordada + Vendedor, Precio Total Acordado / Seña
 * Abonada / Saldo a abonar en la caja de pago, Condiciones de la Preventa,
 * y la garantía aclarando que corre desde la fecha de entrega (no desde
 * este recibo).
 */
function _armarHtmlReciboPreventa_(d) {
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const neg = RECIBO_NEGOCIO;
  const linea = (ancho) => `<span class="linea" style="width:${ancho || 140}px"></span>`;

  const filaPago = (etiqueta, marcado, valorTexto) =>
    `<div class="pago-fila"><span class="chk-box">${marcado ? "☑" : "☐"}</span> <span class="pago-etiqueta">${etiqueta}:</span> ${marcado ? `<b>${valorTexto}</b>` : linea(160)}</div>`;

  const filasPago = [
    filaPago("Efectivo", d.cobradoEf > 0, fmtPeso(d.cobradoEf)),
    filaPago("Dólares", d.cobradoUsd > 0, "USD " + Number(d.cobradoUsd).toLocaleString("en-US")),
    filaPago("Transferencia", d.cobradoTr > 0, fmtPeso(d.cobradoTr)),
    filaPago("Cuotas", d.cobradoCu > 0, "$ " + Number(d.cobradoCu).toLocaleString("es-AR"))
  ].join("");

  const campo = (etiqueta, valor) => `<div class="campo"><span class="etiqueta">${etiqueta}:</span> <span class="valor">${valor}</span></div>`;

  const html = `
  <div class="hoja">
    <div class="encabezado">
      <div class="encabezado-izq">
        <div class="logo">${esc(neg.nombre)}</div>
        <div class="direccion">${esc(neg.direccion)} · ${esc(neg.ciudad)}</div>
        <div class="direccion">Tel: ${esc(neg.telefono)}</div>
      </div>
      <div class="encabezado-der">
        <div class="titulo-recibo">RECIBO DE PREVENTA</div>
        <div class="dato-header">N°: <b>${esc(d.numero)}</b></div>
        <div class="dato-header">Fecha: <b>${esc(d.fecha)}</b></div>
      </div>
    </div>

    <div class="franja-entrega">
      <span>FECHA DE ENTREGA ACORDADA: <b>${esc(d.fechaEntrega) || linea(120)}</b></span>
      <span>VENDEDOR: <b>${esc(d.vendedor) || linea(110)}</b></span>
    </div>

    <div class="seccion-titulo">DATOS DEL DISPOSITIVO SOLICITADO</div>
    <div class="dos-columnas">
      <div class="columna">
        ${campo("Marca/Modelo", `<b>${esc(d.modelo) || "—"}</b>`)}
        ${campo("Color", `<b>${esc(d.color) || linea(140)}</b>`)}
      </div>
      <div class="columna">
        ${campo("IMEI (si se conoce)", `<b>${esc(d.imei) || linea(160)}</b>`)}
        ${campo("Estado requerido", `<b>${esc(d.estadoRequerido) || linea(160)}</b>`)}
      </div>
    </div>

    <div class="seccion-titulo">SEÑA Y FORMA DE PAGO</div>
    <div class="pago-box">
      <div class="pago-total">
        <div class="pago-total-label">PRECIO TOTAL ACORDADO</div>
        <div class="pago-total-monto">${fmtPeso(d.precioTotal)}</div>
        <div class="son-pesos">Son pesos: <b>${numeroAPesosEnLetras_(d.precioTotal)}</b></div>
      </div>
      <div class="pago-total" style="border-right:1px solid var(--gris)">
        <div class="pago-total-label">SEÑA ABONADA</div>
        <div class="pago-total-monto">${fmtPeso(d.senaAbonada)}</div>
        <div class="son-pesos">Saldo a abonar en entrega: <b>${fmtPeso(d.saldoEntrega)}</b></div>
      </div>
      <div class="pago-detalle">
        <div class="pago-detalle-label">DETALLE DEL PAGO DE LA SEÑA</div>
        ${filasPago}
        <div class="pago-fila pago-comprobante">N° comprobante: ${linea(160)}</div>
      </div>
    </div>
    <div class="nota-ajuste">* El precio total definitivo puede ajustarse al momento de la entrega según la cotización del equipo al día de la entrega.</div>

    <div class="seccion-titulo">DATOS DEL COMPRADOR</div>
    <div class="dos-columnas comprador">
      <div class="columna">
        ${campo("Apellido y Nombre", `<b>${esc(d.cliente) || linea(160)}</b>`)}
        ${campo("DNI", `<b>${esc(d.dni) || linea(140)}</b>`)}
        ${campo("CUIL / CUIT", `<b>${esc(d.cuil) || linea(140)}</b>`)}
      </div>
      <div class="columna">
        ${campo("Teléfono", `<b>${esc(d.tel) || linea(140)}</b>`)}
        ${campo("Domicilio", `<b>${esc(d.domicilio) || linea(140)}</b>`)}
        ${campo("Email", `<b>${esc(d.email) || linea(140)}</b>`)}
      </div>
    </div>
    ${d.obs ? `<div class="obs">Observaciones: ${esc(d.obs)}</div>` : ""}

    <div class="seccion-titulo">CONDICIONES DE LA PREVENTA</div>
    <ul class="condiciones">
      <li>La seña abonada es <b>NO reembolsable</b> si el comprador cancela el pedido una vez confirmado.</li>
      <li>Si ${esc(neg.nombre)} no puede conseguir el equipo en el plazo acordado, la seña será devuelta en su totalidad.</li>
      <li>El precio total definitivo puede ajustarse al momento de la entrega según la cotización del equipo.</li>
      <li>El saldo restante deberá abonarse en el momento de retirar el equipo en el local.</li>
      <li>La garantía de ${neg.garantiaMeses} meses comienza desde la <b>fecha de entrega efectiva</b> al comprador, no desde la emisión de este recibo.</li>
    </ul>

    <div class="seccion-titulo">GARANTÍA</div>
    <div class="garantia">
      <p>El equipo adquirido cuenta con una garantía de <b>${neg.garantiaMeses} (doce) meses</b> desde la fecha de entrega efectiva al comprador.
      La garantía cubre únicamente fallas técnicas de origen no provocadas por el cliente, incluyendo problemas de encendido, fallas internas de pantalla,
      batería defectuosa de origen, fallas de software persistentes, problemas de carga, audio, cámara o conectividad. Toda garantía queda sujeta a
      diagnóstico y verificación técnica por parte del local.</p>
      <p>La garantía NO cubre: pantallas rotas, fisuradas o con daño físico; golpes, rayones, deformaciones o daños estéticos; daño por líquido o humedad;
      equipos abiertos, manipulados o reparados por terceros; daños ocasionados por accesorios no originales o uso incorrecto; problemas relacionados con
      cuentas, contraseñas o bloqueos del usuario; daños eléctricos externos; fallas posteriores al vencimiento del plazo de garantía. Si el equipo
      presenta evidencia física de golpe, humedad o manipulación externa, la garantía quedará automáticamente anulada.</p>
      <p>En caso de ingreso por garantía: 1) El equipo será evaluado técnicamente. 2) El local determinará si corresponde garantía según el diagnóstico
      realizado. 3) Si corresponde garantía, el local podrá optar por: reparación, reemplazo del equipo, o devolución del dinero abonado (última instancia).</p>
      <p>El cliente declara haber recibido el equipo en correcto estado de funcionamiento y haber leído y aceptado las presentes condiciones de garantía.</p>
    </div>

    <div class="firmas">
      <div class="firma-col">
        <img class="firma-img" src="data:image/png;base64,${RECIBO_FIRMA_TITULAR_BASE64}" alt="Firma">
        <div class="firma-linea"></div>
        <div class="firma-label">${esc(neg.nombre)} / ${esc(neg.titular)} — DNI ${esc(neg.dniTitular)}</div>
      </div>
      <div class="firma-col">
        <div class="firma-linea"></div>
        <div class="firma-label">Comprador — Aclaración y DNI</div>
      </div>
    </div>

    <div class="pie-separador"></div>
    <div class="pie">Al firmar, el comprador declara haber leído y aceptado las condiciones de preventa y garantía. ${esc(neg.nombre)} · ${esc(neg.direccion)}, ${esc(neg.ciudad)} · ${esc(neg.telefono)}</div>
  </div>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Recibo Preventa ${esc(d.numero)}</title>
<style>
  :root { --naranja: #E07B1E; --gris: #D9D9D9; --gris-texto: #6B6B6B; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; font-size: 11.5px; }

  .hoja { width: 190mm; padding: 4mm 12mm; margin: 0 auto; }

  .encabezado { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 8px; }
  .logo { font-size: 26px; font-weight: bold; letter-spacing: .3px; }
  .direccion { font-size: 10.5px; color: var(--gris-texto); margin-top: 3px; }
  .encabezado-der { text-align: right; }
  .titulo-recibo { font-size: 22px; font-weight: bold; color: var(--naranja); letter-spacing: .5px; margin-bottom: 6px; }
  .dato-header { font-size: 11.5px; margin-top: 2px; }

  .franja-entrega {
    display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px;
    background: #FDF1E6; border: 1px solid var(--naranja); border-radius: 4px;
    padding: 8px 14px; margin: 10px 0 4px; font-size: 11px; font-weight: 600;
  }

  .seccion-titulo {
    font-weight: bold; font-size: 12px; text-transform: uppercase; letter-spacing: .4px;
    margin: 11px 0 7px; padding-bottom: 4px; border-bottom: 3px solid var(--naranja);
  }

  .dos-columnas { display: flex; gap: 40px; }
  .dos-columnas .columna { flex: 1; display: flex; flex-direction: column; gap: 7px; }
  .dos-columnas.comprador { position: relative; }
  .dos-columnas.comprador::after {
    content: ""; position: absolute; top: 2px; bottom: 2px; left: 50%;
    width: 1px; background: var(--gris); margin-left: -20px;
  }
  .campo { font-size: 11.5px; }
  .etiqueta { font-weight: bold; }
  .valor { font-weight: normal; }

  .linea { display: inline-block; border-bottom: 1px solid #1a1a1a; height: 12px; vertical-align: bottom; margin: 0 2px; }

  .pago-box { display: flex; border: 2px solid var(--naranja); margin-top: 4px; }
  .pago-total { flex: 0 0 27%; text-align: center; padding: 10px 10px; }
  .pago-total-label { font-size: 10px; font-weight: bold; letter-spacing: .3px; }
  .pago-total-monto { font-size: 21px; font-weight: bold; margin-top: 6px; }
  .son-pesos { font-size: 9px; color: var(--gris-texto); margin-top: 8px; }
  .pago-detalle { flex: 1; padding: 10px 18px; border-left: 1px solid var(--gris); }
  .pago-detalle-label { font-weight: bold; font-size: 10.5px; letter-spacing: .3px; margin-bottom: 8px; }
  .pago-fila { margin: 4px 0; font-size: 10.5px; }
  .pago-etiqueta { font-weight: bold; }
  .pago-comprobante { margin-top: 6px; }
  .nota-ajuste { font-size: 9px; font-style: italic; color: var(--gris-texto); margin-top: 6px; }

  .obs { font-size: 11px; margin-top: 6px; color: var(--gris-texto); }

  .condiciones { font-size: 9.5px; line-height: 1.6; margin: 4px 0; padding-left: 16px; color: #2b2b2b; }
  .condiciones li { margin-bottom: 2px; }

  .garantia { font-size: 8.5px; line-height: 1.4; text-align: justify; color: #2b2b2b; }
  .garantia p { margin: 0 0 5px; }

  .firmas { display: flex; gap: 50px; margin-top: 55px; }
  .firma-col { flex: 1; text-align: center; position: relative; }
  .firma-linea { border-top: 1px solid #1a1a1a; margin-bottom: 6px; margin-top: 85px; }
  .firma-label { font-size: 10.5px; font-weight: bold; }
  .firma-img { position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%); height: 95px; width: auto; }

  .pie-separador { border-top: 1px solid var(--gris); margin-top: 8px; }
  .pie { text-align: center; font-size: 8.5px; color: var(--gris-texto); margin-top: 4px; }

  @page { size: A4; margin: 4mm 8mm; }
  @media print { .hoja { width: 100%; } }
</style>
</head>
<body>
  ${html}
  <script>
    window.onload = function () {
      window.print();
    };
  </script>
</body>
</html>`;
}

// ============================================================
//  Recibo de Compraventa y Cesión de Titularidad — solo para compras de
//  equipo a un particular (Tipo Ingreso = "COMPRA"; una consignación NO
//  transfiere titularidad, el equipo sigue siendo del dueño original, así
//  que ese caso no genera este documento). Mismo patrón autocontenido que
//  el resto de recibos.gs — solo lectura sobre "Compras", sin registrar
//  ni modificar nada.
// ============================================================

/**
 * separarModeloYCapacidad_(modeloCompleto)
 *
 * El campo "Equipo / Modelo" de Compras guarda el modelo y la capacidad
 * juntos en el mismo texto (ej. "iPhone 15 Pro 256GB", "MacBook Air M2
 * 8GB/256GB" — así los arma crearSelectorModelos() en toda la app). La
 * Cesión de Titularidad los muestra en líneas separadas ("Marca/Modelo" y
 * "Capacidad"), así que acá se separan con una expresión regular sobre el
 * patrón de almacenamiento más común (ej. "256GB", "8GB/256GB", "1TB").
 * Si no matchea (equipo cargado con texto libre), Capacidad queda vacía y
 * todo el texto se muestra tal cual en Marca/Modelo — no se inventa nada.
 */
function separarModeloYCapacidad_(modeloCompleto) {
  const texto = String(modeloCompleto || "").trim();
  const m = texto.match(/^(.*?)\s+((?:\d+\s?(?:GB|TB)\/)?\d+\s?(?:GB|TB))$/i);
  if (!m) return { modelo: texto, capacidad: "" };
  return { modelo: m[1].trim(), capacidad: m[2].trim() };
}

/**
 * generarReciboCesion(numeroCompra)
 *
 * Busca la compra por su N° OP en "Compras" y arma el recibo imprimible
 * (una hoja A4) de compraventa y cesión de titularidad. Si la operación es
 * una CONSIGNACION (no transfiere titularidad), tira error explícito en
 * vez de generar un documento que no corresponde.
 */
function generarReciboCesion(numeroCompra) {
  const numero = String(numeroCompra || "").trim();
  if (!numero) throw new Error("❌ Falta el número de compra.");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Compras");
  if (!sheet) throw new Error("❌ Hoja 'Compras' no encontrada.");

  const fE = 2;
  const cOP  = getCol(sheet, "N° OP",                 fE);
  const cFec = getCol(sheet, "Fecha Ingreso",          fE);
  const cTip = getCol(sheet, "Tipo Ingreso",           fE);
  const cPrv = getCol(sheet, "Proveedor / Origen",     fE);
  const cMod = getCol(sheet, "Equipo / Modelo",        fE);
  const cIme = getCol(sheet, "IMEI",                   fE);
  const cCol = getCol(sheet, "Color",                  fE);
  const cEst = getCol(sheet, "Estado Físico",          fE);
  const cPC  = getCol(sheet, "Precio Compra",          fE);
  const cFP  = getCol(sheet, "Forma de Pago Compra",   fE);
  let cCuil = -1, cDom = -1, cLoc = -1, cEml = -1;
  try { cCuil = getCol(sheet, "CUIL/CUIT Proveedor", fE); } catch (e) { /* opcional */ }
  try { cDom  = getCol(sheet, "Domicilio Proveedor", fE); } catch (e) { /* opcional */ }
  try { cLoc  = getCol(sheet, "Localidad Proveedor", fE); } catch (e) { /* opcional */ }
  try { cEml  = getCol(sheet, "Email Proveedor",     fE); } catch (e) { /* opcional */ }

  const lastRow = sheet.getLastRow();
  if (lastRow <= fE) throw new Error(`❌ "${numero}" no encontrado en "Compras".`);
  const datosC = sheet.getRange(fE + 1, 1, lastRow - fE, sheet.getLastColumn()).getValues();
  const fila = datosC.find(r => String(r[cOP - 1]).trim() === numero);
  if (!fila) throw new Error(`❌ "${numero}" no encontrado en "Compras".`);

  const tipoIngreso = String(fila[cTip - 1] || "").trim();
  if (tipoIngreso !== "COMPRA") {
    throw new Error(`❌ "${numero}" es una ${tipoIngreso || "operación"}, no una COMPRA — la cesión de titularidad no corresponde (el equipo sigue siendo del dueño original hasta que se venda).`);
  }

  const tz = Session.getScriptTimeZone();
  const fechaRaw = fila[cFec - 1];
  const fecha = fechaRaw instanceof Date ? Utilities.formatDate(fechaRaw, tz, "dd/MM/yyyy") : String(fechaRaw || "");

  const { modelo, capacidad } = separarModeloYCapacidad_(fila[cMod - 1]);
  const cuil = cCuil > 0 ? String(fila[cCuil - 1] || "") : "";

  const datos = {
    numero:      numero,
    fecha:       fecha,
    modelo:      modelo,
    capacidad:   capacidad,
    imei:        String(fila[cIme - 1] || ""),
    color:       String(fila[cCol - 1] || ""),
    estado:      String(fila[cEst - 1] || ""),
    vendedor:    String(fila[cPrv - 1] || ""),
    cuil:        cuil,
    dni:         extraerDniDeCuil_(cuil),
    domicilio:   cDom > 0 ? String(fila[cDom - 1] || "") : "",
    localidad:   cLoc > 0 ? String(fila[cLoc - 1] || "") : "",
    email:       cEml > 0 ? String(fila[cEml - 1] || "") : "",
    precio:      Number(fila[cPC - 1]) || 0,
    formaPago:   String(fila[cFP - 1] || "")
  };

  return _armarHtmlReciboCesion_(datos);
}

/** Arma el documento HTML de la Cesión de Titularidad. SOLO diseño — mismo sistema (1 hoja A4, firma estampada) que los demás recibos de recibos.gs, con la distribución propia de este documento (banner naranja único, todo a una columna, comprador/cesionario fijo = GreatPhones). */
function _armarHtmlReciboCesion_(d) {
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const neg = RECIBO_NEGOCIO;
  const linea = (ancho) => `<span class="linea" style="width:${ancho || 160}px"></span>`;

  const campo = (etiqueta, valor) => `<div class="campo-fila"><span class="etiqueta">${etiqueta}:</span> ${valor}</div>`;

  const pagoEfectivo = /efectivo/i.test(d.formaPago);
  const pagoTransf    = /transfer/i.test(d.formaPago);
  const chk = (marcado, texto) => `<span class="chk"><span class="chk-box">${marcado ? "☑" : "☐"}</span> ${texto}</span>`;

  const html = `
  <div class="hoja">
    <div class="banner">
      <div class="banner-logo">${esc(neg.nombre)}</div>
      <div class="banner-titulo">RECIBO DE COMPRAVENTA Y CESIÓN DE TITULARIDAD — TELÉFONO CELULAR</div>
    </div>
    <div class="dato-header-fila">
      <span>N° OP: <b>${esc(d.numero)}</b></span>
      <span>Fecha: <b>${esc(d.fecha)}</b></span>
    </div>

    <div class="seccion-titulo">DATOS DEL DISPOSITIVO</div>
    ${campo("Marca / Modelo", `<b>${esc(d.modelo) || "—"}</b>`)}
    ${campo("N° IMEI", `<b>${esc(d.imei) || linea(220)}</b>`)}
    ${campo("N° de Serie", linea(220))}
    ${campo("Color", `<b>${esc(d.color) || linea(200)}</b>`)}
    ${campo("Capacidad", `<b>${esc(d.capacidad) || linea(140)}</b>`)}
    ${campo("Estado", `<b>${esc(d.estado) || linea(200)}</b>`)}

    <div class="seccion-titulo">DATOS DEL VENDEDOR (CEDENTE)</div>
    ${campo("Apellido y Nombre", `<b>${esc(d.vendedor) || linea(260)}</b>`)}
    ${campo("DNI N°", `<b>${esc(d.dni) || linea(160)}</b>`)}
    ${campo("CUIL", `<b>${esc(d.cuil) || linea(160)}</b>`)}
    ${campo("Domicilio", `<b>${esc(d.domicilio) || linea(260)}</b>`)}
    ${campo("Localidad", `<b>${esc(d.localidad) || linea(200)}</b>`)}
    ${campo("Gmail", `<b>${esc(d.email) || linea(220)}</b>`)}

    <div class="valor-box">
      <div class="valor-fila"><span class="valor-label">VALOR DECLARADO:</span> <span class="valor-monto">${fmtPeso(d.precio)}</span> <span class="valor-pesos">(pesos)</span></div>
      <div class="valor-pago">
        ${chk(pagoEfectivo, "Efectivo (en mano)")}
        ${chk(pagoTransf, "Transferencia bancaria")}
        <span>N° ref / comprobante: ${linea(180)}</span>
      </div>
    </div>

    <div class="seccion-titulo">DATOS DEL COMPRADOR / NUEVO TITULAR (CESIONARIO)</div>
    ${campo("Apellido y Nombre", `<b>${esc(neg.titularCompleto)}</b>`)}
    ${campo("CUIL / Razón social", `<b>${esc(neg.cuilTitular)} — ${esc(neg.nombre)} · ${esc(neg.direccion)}, ${esc(neg.ciudad)} · Tel: ${esc(neg.telefono)}</b>`)}

    <div class="seccion-titulo">DECLARACIÓN DE CESIÓN DE TITULARIDAD</div>
    <div class="declaracion">
      Declaro ser legítimo/a propietario/a del dispositivo detallado, libre de deudas, gravámenes y denuncias por robo/hurto, y <b>CEDO,
      TRANSFIERO Y TRASPASO</b> en forma definitiva e irrevocable la plena titularidad a favor de ${esc(neg.titularCompleto)} (CUIL
      ${esc(neg.cuilTitular)}), propietario de ${esc(neg.nombre)}, haciéndome responsable de cualquier reclamo de terceros derivado de mi
      tenencia anterior y declarando haber recibido el valor consignado en pesos argentinos a mi entera satisfacción.
    </div>

    <div class="lugar-fecha">Lugar y fecha: <b>${esc(neg.ciudad)}, ${esc(d.fecha)}</b></div>

    <div class="firmas-cesion">
      <div class="firma-col">
        <div class="firma-linea"></div>
        <div class="firma-label">Aclaración y DNI — Vendedor</div>
      </div>
      <div class="firma-col">
        <img class="firma-img" src="data:image/png;base64,${RECIBO_FIRMA_TITULAR_BASE64}" alt="Firma">
        <div class="firma-linea"></div>
        <div class="firma-label">${esc(neg.titularCompleto)} — DNI ${esc(neg.dniTitular)}<br>Firma del Comprador</div>
      </div>
    </div>

    <div class="pie-separador"></div>
    <div class="pie">Este documento acredita la transferencia de titularidad del dispositivo. ${esc(neg.nombre)} · ${esc(neg.direccion)}, ${esc(neg.ciudad)} · Tel: ${esc(neg.telefono)}</div>
  </div>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Cesión de Titularidad ${esc(d.numero)}</title>
<style>
  :root { --naranja: #E07B1E; --gris: #D9D9D9; --gris-texto: #6B6B6B; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; font-size: 11.5px; }

  .hoja { width: 190mm; padding: 4mm 12mm; margin: 0 auto; }

  .banner { background: #FDF1E6; border: 1px solid var(--naranja); border-radius: 4px; padding: 10px 14px; text-align: center; }
  .banner-logo { font-size: 16px; font-weight: bold; }
  .banner-titulo { font-size: 11.5px; font-weight: bold; margin-top: 3px; letter-spacing: .2px; }
  .dato-header-fila { display: flex; justify-content: flex-end; gap: 24px; font-size: 11px; margin: 6px 0 2px; }

  .seccion-titulo {
    font-weight: bold; font-size: 12px; text-transform: uppercase; letter-spacing: .4px;
    margin: 12px 0 7px; padding-bottom: 4px; border-bottom: 3px solid var(--naranja);
  }

  .campo-fila { display: flex; gap: 10px; font-size: 11.5px; margin-bottom: 6px; align-items: baseline; }
  .campo-fila .etiqueta { font-weight: bold; flex: 0 0 150px; }

  .linea { display: inline-block; border-bottom: 1px solid #1a1a1a; height: 12px; vertical-align: bottom; margin: 0 2px; }

  .valor-box { border: 2px solid var(--naranja); border-radius: 4px; padding: 10px 16px; margin: 10px 0 4px; }
  .valor-fila { display: flex; align-items: baseline; gap: 8px; }
  .valor-label { font-weight: bold; font-size: 12px; }
  .valor-monto { font-size: 19px; font-weight: bold; }
  .valor-pesos { font-size: 10px; color: var(--gris-texto); font-style: italic; }
  .valor-pago { display: flex; flex-wrap: wrap; gap: 22px; font-size: 10.5px; margin-top: 8px; }
  .chk-box { font-size: 13px; position: relative; top: 1px; }

  .declaracion { font-size: 9.5px; line-height: 1.5; text-align: justify; color: #2b2b2b; margin-top: 2px; }

  .lugar-fecha { font-size: 11px; margin-top: 14px; }

  .firmas-cesion { display: flex; gap: 50px; margin-top: 60px; }
  .firma-col { flex: 1; text-align: center; position: relative; }
  .firma-linea { border-top: 1px solid #1a1a1a; margin-bottom: 6px; margin-top: 78px; }
  .firma-label { font-size: 10px; font-weight: bold; }
  .firma-img { position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%); height: 88px; width: auto; }

  .pie-separador { border-top: 1px solid var(--gris); margin-top: 10px; }
  .pie { text-align: center; font-size: 8.5px; color: var(--gris-texto); margin-top: 4px; }

  @page { size: A4; margin: 4mm 8mm; }
  @media print { .hoja { width: 100%; } }
</style>
</head>
<body>
  ${html}
  <script>
    window.onload = function () {
      window.print();
    };
  </script>
</body>
</html>`;
}

// ============================================================
//  Ticket de Ingreso por Reparación / Garantía — mismo patrón que el
//  resto de recibos.gs (documento HTML autocontenido, solo lectura,
//  window.print() al cargar). Una sola función lee "Reparaciones" y
//  elige la plantilla según el campo "Tipo" de la reparación:
//    - "Garantía"                → _armarHtmlReciboGarantia_ (sin precio,
//      con el texto legal de condiciones de garantía, banner negro+naranja)
//    - cualquier otro valor      → _armarHtmlReciboReparacion_ (con precio
//      y forma de pago, banner blanco con título naranja — igual que
//      Venta/Preventa/Cesión)
// ============================================================

/**
 * generarReciboReparacion(numeroReparacion)
 *
 * Busca la reparación por su N° Rep en "Reparaciones" y arma el ticket de
 * ingreso imprimible (una hoja A4), con la plantilla que corresponda según
 * el Tipo de la reparación (Particular/Preventa/Interno → recibo con
 * precio; Garantía → recibo de condiciones, sin precio).
 */
function generarReciboReparacion(numeroReparacion) {
  const numero = String(numeroReparacion || "").trim();
  if (!numero) throw new Error("❌ Falta el número de reparación.");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Reparaciones");
  if (!sheet) throw new Error("❌ Hoja 'Reparaciones' no encontrada.");

  const fE = 2;
  const cNR  = getCol(sheet, "N° Rep",         fE);
  const cFE  = getCol(sheet, "Fecha Ingreso",  fE);
  const cTI  = getCol(sheet, "Tipo",           fE);
  const cCL  = getCol(sheet, "Cliente",        fE);
  const cTE  = getCol(sheet, "Teléfono",       fE);
  const cEQ  = getCol(sheet, "Equipo",         fE);
  const cIM  = getCol(sheet, "IMEI",           fE);
  const cF1  = getCol(sheet, "Falla 1",        fE);
  const cF2  = getCol(sheet, "Falla 2",        fE);
  const cPC  = getCol(sheet, "Precio Cobrado", fE);
  const cEF  = getCol(sheet, "Cobrado Efectivo",      fE);
  const cTR  = getCol(sheet, "Cobrado Transferencia", fE);
  let cDNI = -1, cEML = -1, cCOL = -1, cBAT = -1;
  try { cDNI = getCol(sheet, "DNI Cliente",   fE); } catch (e) { /* opcional */ }
  try { cEML = getCol(sheet, "Email Cliente", fE); } catch (e) { /* opcional */ }
  try { cCOL = getCol(sheet, "Color",         fE); } catch (e) { /* opcional */ }
  try { cBAT = getCol(sheet, "Batería",       fE); } catch (e) { /* opcional */ }

  const lastRow = sheet.getLastRow();
  if (lastRow <= fE) throw new Error(`❌ "${numero}" no encontrado en "Reparaciones".`);
  const datosR = sheet.getRange(fE + 1, 1, lastRow - fE, sheet.getLastColumn()).getValues();
  const fila = datosR.find(r => String(r[cNR - 1]).trim() === numero);
  if (!fila) throw new Error(`❌ "${numero}" no encontrado en "Reparaciones".`);

  const tz = Session.getScriptTimeZone();
  const fechaRaw = fila[cFE - 1];
  const fecha = fechaRaw instanceof Date ? Utilities.formatDate(fechaRaw, tz, "dd/MM/yyyy") : String(fechaRaw || "");

  let falla = String(fila[cF1 - 1] || "");
  if (fila[cF2 - 1]) falla += (falla ? " / " : "") + fila[cF2 - 1];

  const tipo = String(fila[cTI - 1] || "").trim();

  const datos = {
    numero:    numero,
    fecha:     fecha,
    tipo:      tipo,
    cliente:   String(fila[cCL - 1] || ""),
    tel:       String(fila[cTE - 1] || ""),
    dni:       cDNI > 0 ? String(fila[cDNI - 1] || "") : "",
    email:     cEML > 0 ? String(fila[cEML - 1] || "") : "",
    equipo:    String(fila[cEQ - 1] || ""),
    imei:      String(fila[cIM - 1] || ""),
    color:     cCOL > 0 ? String(fila[cCOL - 1] || "") : "",
    bateria:   cBAT > 0 ? String(fila[cBAT - 1] || "") : "",
    falla:     falla,
    precio:    Number(fila[cPC - 1]) || 0,
    cobradoEf: Number(fila[cEF - 1]) || 0,
    cobradoTr: Number(fila[cTR - 1]) || 0
  };

  return (tipo === "Garantía")
    ? _armarHtmlReciboGarantia_(datos)
    : _armarHtmlReciboReparacion_(datos);
}

/** CSS compartido por las dos plantillas de este archivo (idéntico salvo el color del banner, ver cada función) — evita duplicar 40 líneas de estilos casi iguales. */
function _cssBaseTicketReparacion_(bannerCss) {
  return `
  :root { --naranja: #E07B1E; --gris: #D9D9D9; --gris-texto: #6B6B6B; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; font-size: 11.5px; }
  .hoja { width: 190mm; padding: 4mm 12mm; margin: 0 auto; }
  ${bannerCss}
  .dato-header-fila { display: flex; justify-content: flex-end; gap: 24px; font-size: 11px; margin: 6px 0 2px; }
  .seccion-titulo {
    font-weight: bold; font-size: 12px; text-transform: uppercase; letter-spacing: .4px;
    margin: 14px 0 8px; padding-bottom: 5px; border-bottom: 3px solid var(--naranja);
  }
  .dos-columnas { display: flex; gap: 40px; }
  .dos-columnas .columna { flex: 1; display: flex; flex-direction: column; gap: 7px; }
  .campo { font-size: 11.5px; }
  .etiqueta { font-weight: bold; }
  .linea { display: inline-block; border-bottom: 1px solid #1a1a1a; height: 12px; vertical-align: bottom; margin: 0 2px; }
  .falla-box { border: 1px solid var(--gris); border-radius: 4px; padding: 10px 14px; min-height: 42px; font-size: 11.5px; margin-top: 2px; }
  .pago-box { display: flex; border: 2px solid var(--naranja); margin-top: 4px; }
  .pago-total { flex: 0 0 34%; text-align: center; padding: 10px 14px; border-right: 1px solid var(--gris); }
  .pago-total-label { font-size: 11px; font-weight: bold; letter-spacing: .3px; }
  .pago-total-monto { font-size: 26px; font-weight: bold; margin-top: 8px; }
  .son-pesos { font-size: 10px; color: var(--gris-texto); margin-top: 8px; }
  .pago-detalle { flex: 1; padding: 10px 20px; }
  .pago-detalle-label { font-weight: bold; font-size: 11px; letter-spacing: .3px; margin-bottom: 6px; }
  .pago-fila { margin: 5px 0; font-size: 11.5px; }
  .pago-etiqueta { font-weight: bold; }
  .pago-comprobante { margin-top: 8px; }
  .chk-box { font-size: 13px; position: relative; top: 1px; }
  .garantia-texto { font-size: 9px; line-height: 1.5; text-align: justify; color: #2b2b2b; font-style: italic; margin-top: 4px; }
  .firmas { display: flex; gap: 50px; margin-top: 65px; }
  .firma-col { flex: 1; text-align: center; position: relative; }
  .firma-linea { border-top: 1px solid #1a1a1a; margin-bottom: 6px; margin-top: 85px; }
  .firma-label { font-size: 10.5px; font-weight: bold; }
  .firma-img { position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%); height: 95px; width: auto; }
  .pie-separador { border-top: 1px solid var(--gris); margin-top: 10px; }
  .pie { text-align: center; font-size: 8.5px; color: var(--gris-texto); margin-top: 4px; }
  @page { size: A4; margin: 4mm 8mm; }
  @media print { .hoja { width: 100%; } }
  `;
}

/** Bloque común "DATOS DEL DISPOSITIVO" + "DATOS DEL CLIENTE" + "FALLA DETECTADA", igual en las 2 plantillas (Particular/Garantía) — ver GARANTIA_TEXTO más abajo para la única diferencia real entre ambas. */
function _bloqueDispositivoYClienteReparacion_(d, linea, campo, esc) {
  return `
    <div class="seccion-titulo">DATOS DEL DISPOSITIVO</div>
    <div class="dos-columnas">
      <div class="columna">
        ${campo("Marca/Modelo", `<b>${esc(d.equipo) || "—"}</b>`)}
        ${campo("Color", `<b>${esc(d.color) || linea(160)}</b>`)}
      </div>
      <div class="columna">
        ${campo("IMEI", `<b>${esc(d.imei) || linea(180)}</b>`)}
        ${campo("Batería", `<b>${esc(d.bateria) || linea(160)}</b>`)}
      </div>
    </div>

    <div class="seccion-titulo">DATOS DEL CLIENTE</div>
    <div class="dos-columnas">
      <div class="columna">
        ${campo("Apellido y Nombre", `<b>${esc(d.cliente) || linea(200)}</b>`)}
        ${campo("DNI", `<b>${esc(d.dni) || linea(160)}</b>`)}
      </div>
      <div class="columna">
        ${campo("Tel", `<b>${esc(d.tel) || linea(160)}</b>`)}
        ${campo("Email", `<b>${esc(d.email) || linea(180)}</b>`)}
      </div>
    </div>

    <div class="seccion-titulo">FALLA DETECTADA POR EL CLIENTE</div>
    <div class="falla-box">${esc(d.falla) || "—"}</div>`;
}

/** Ticket de Ingreso por Reparación (Particular/Preventa/Interno) — con precio y forma de pago. */
function _armarHtmlReciboReparacion_(d) {
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const neg = RECIBO_NEGOCIO;
  const linea = (ancho) => `<span class="linea" style="width:${ancho || 160}px"></span>`;
  const campo = (etiqueta, valor) => `<div class="campo"><span class="etiqueta">${etiqueta}:</span> <span class="valor">${valor}</span></div>`;

  const filaPago = (etiqueta, marcado, valorTexto) =>
    `<div class="pago-fila"><span class="chk-box">${marcado ? "☑" : "☐"}</span> <span class="pago-etiqueta">${etiqueta}:</span> ${marcado ? `<b>${valorTexto}</b>` : linea(170)}</div>`;
  const filasPago = [
    filaPago("Efectivo", d.cobradoEf > 0, fmtPeso(d.cobradoEf)),
    filaPago("Dólares", false, ""),
    filaPago("Transferencia", d.cobradoTr > 0, fmtPeso(d.cobradoTr)),
    filaPago("Cuotas", false, "")
  ].join("");

  const html = `
  <div class="hoja">
    <div class="encabezado">
      <div class="encabezado-izq">
        <div class="logo">${esc(neg.nombre)}</div>
        <div class="direccion">${esc(neg.direccion)} · ${esc(neg.ciudad)} · ${esc(neg.telefono)}</div>
      </div>
      <div class="encabezado-der">
        <div class="titulo-recibo">INGRESO POR REPARACIÓN</div>
        <div class="dato-header">Ticket N°: <b>${esc(d.numero)}</b></div>
        <div class="dato-header">Fecha: <b>${esc(d.fecha)}</b></div>
      </div>
    </div>

    ${_bloqueDispositivoYClienteReparacion_(d, linea, campo, esc)}

    <div class="seccion-titulo">PRECIO Y FORMA DE PAGO</div>
    <div class="pago-box">
      <div class="pago-total">
        <div class="pago-total-label">PRECIO TOTAL</div>
        <div class="pago-total-monto">${d.precio > 0 ? fmtPeso(d.precio) : linea(140)}</div>
        <div class="son-pesos">Son pesos: ${d.precio > 0 ? `<b>${numeroAPesosEnLetras_(d.precio)}</b>` : linea(150)}</div>
      </div>
      <div class="pago-detalle">
        <div class="pago-detalle-label">DETALLE DEL PAGO</div>
        ${filasPago}
        <div class="pago-fila pago-comprobante">N° comprobante: ${linea(200)}</div>
      </div>
    </div>

    <div class="firmas">
      <div class="firma-col">
        <img class="firma-img" src="data:image/png;base64,${RECIBO_FIRMA_TITULAR_BASE64}" alt="Firma">
        <div class="firma-linea"></div>
        <div class="firma-label">${esc(neg.nombre)} / ${esc(neg.titular)} — DNI ${esc(neg.dniTitular)}</div>
      </div>
      <div class="firma-col">
        <div class="firma-linea"></div>
        <div class="firma-label">Cliente — Aclaración y DNI</div>
      </div>
    </div>

    <div class="pie-separador"></div>
    <div class="pie">${esc(neg.nombre)} · ${esc(neg.direccion)}, ${esc(neg.ciudad)} · ${esc(neg.telefono)}</div>
  </div>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Ingreso Reparación ${esc(d.numero)}</title>
<style>
  ${_cssBaseTicketReparacion_(`
  .encabezado { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 8px; }
  .logo { font-size: 26px; font-weight: bold; letter-spacing: .3px; }
  .direccion { font-size: 10.5px; color: var(--gris-texto); margin-top: 3px; }
  .encabezado-der { text-align: right; }
  .titulo-recibo { font-size: 20px; font-weight: bold; color: var(--naranja); letter-spacing: .5px; margin-bottom: 6px; }
  .dato-header { font-size: 11.5px; margin-top: 2px; }
  `)}
</style>
</head>
<body>
  ${html}
  <script>
    window.onload = function () {
      window.print();
    };
  </script>
</body>
</html>`;
}

/** Texto legal de garantía del ticket de ingreso (distinto y mucho más breve que el de la garantía POST-venta de recibos.gs — este es el aviso que se firma AL DEJAR el equipo, no las condiciones completas de reparación bajo garantía). */
const RECIBO_TEXTO_GARANTIA_INGRESO =
  "La garantía cubre fallas técnicas de origen no provocadas por el cliente. NO cubre: pantallas rotas, golpes, daño por líquido, equipos " +
  "abiertos o reparados por terceros, daños eléctricos, bloqueos de cuenta. Si se detecta daño físico o manipulación externa, la garantía " +
  "queda automáticamente sin efecto. GreatPhones no se responsabiliza por información personal almacenada en el dispositivo.";

/** Ticket de Ingreso por Garantía — sin precio, con el aviso legal de condiciones y banner negro+naranja (igual al recibo de referencia). */
function _armarHtmlReciboGarantia_(d) {
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const neg = RECIBO_NEGOCIO;
  const linea = (ancho) => `<span class="linea" style="width:${ancho || 160}px"></span>`;
  const campo = (etiqueta, valor) => `<div class="campo"><span class="etiqueta">${etiqueta}:</span> <span class="valor">${valor}</span></div>`;

  const html = `
  <div class="hoja">
    <div class="encabezado">
      <div class="banda-negra"><div class="logo">${esc(neg.nombre)}</div></div>
      <div class="banda-naranja"><div class="titulo-recibo">INGRESO POR GARANTÍA</div></div>
    </div>
    <div class="direccion-fila">${esc(neg.direccion)} · ${esc(neg.ciudad)} · ${esc(neg.telefono)}</div>
    <div class="dato-header-fila">
      <span>Ticket N°: <b>${esc(d.numero)}</b></span>
      <span>Fecha: <b>${esc(d.fecha)}</b></span>
    </div>

    ${_bloqueDispositivoYClienteReparacion_(d, linea, campo, esc)}

    <div class="garantia-texto">${RECIBO_TEXTO_GARANTIA_INGRESO}</div>

    <div class="firmas">
      <div class="firma-col">
        <img class="firma-img" src="data:image/png;base64,${RECIBO_FIRMA_TITULAR_BASE64}" alt="Firma">
        <div class="firma-linea"></div>
        <div class="firma-label">${esc(neg.nombre)} / ${esc(neg.titular)} — DNI ${esc(neg.dniTitular)}</div>
      </div>
      <div class="firma-col">
        <div class="firma-linea"></div>
        <div class="firma-label">Cliente — Aclaración y DNI</div>
      </div>
    </div>

    <div class="pie-separador"></div>
    <div class="pie">El cliente declara entregar el equipo en el estado descripto. ${esc(neg.nombre)} · ${esc(neg.direccion)}, ${esc(neg.ciudad)} · ${esc(neg.telefono)}</div>
  </div>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Ingreso Garantía ${esc(d.numero)}</title>
<style>
  ${_cssBaseTicketReparacion_(`
  .encabezado { display: flex; }
  .banda-negra { background: #1a1a1a; color: #fff; padding: 10px 16px; display: flex; align-items: center; }
  .banda-negra .logo { font-size: 20px; font-weight: bold; color: var(--naranja); }
  .banda-naranja { background: var(--naranja); color: #fff; padding: 10px 16px; flex: 1; display: flex; align-items: center; justify-content: center; }
  .banda-naranja .titulo-recibo { font-size: 18px; font-weight: bold; letter-spacing: .5px; }
  .direccion-fila { font-size: 10px; color: var(--gris-texto); margin: 4px 0 0 2px; }
  `)}
</style>
</head>
<body>
  ${html}
  <script>
    window.onload = function () {
      window.print();
    };
  </script>
</body>
</html>`;
}

// ============================================================
//  Comprobante de Entrega — Reparación. Mismo patrón que el resto de
//  recibos.gs (documento HTML autocontenido, solo lectura, window.print()
//  al cargar). No hay referencia en papel para este — se diseña siguiendo
//  la misma línea visual que los demás (banner con título naranja, caja
//  de precio con bordes rectos, garantía propia de la reparación —
//  90 días sobre el trabajo realizado, distinta de la garantía de 12
//  meses de una venta — firma estampada del titular).
// ============================================================

/**
 * generarReciboEntregaReparacion(numeroReparacion)
 *
 * Busca la reparación por su N° Rep en "Reparaciones" — debe estar en
 * estado "✅ Retirado" (ya entregada, ver entregarReparacion() en
 * entrega_reparaciones.gs) — y arma el comprobante imprimible (una hoja
 * A4) con el total cobrado acumulado (ingreso + cobro final de la entrega).
 */
function generarReciboEntregaReparacion(numeroReparacion) {
  const numero = String(numeroReparacion || "").trim();
  if (!numero) throw new Error("❌ Falta el número de reparación.");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Reparaciones");
  if (!sheet) throw new Error("❌ Hoja 'Reparaciones' no encontrada.");

  const fE = 2;
  const cNR  = getCol(sheet, "N° Rep",         fE);
  const cFE2 = getCol(sheet, "Fecha Egreso",   fE);
  const cCL  = getCol(sheet, "Cliente",        fE);
  const cTE  = getCol(sheet, "Teléfono",       fE);
  const cEQ  = getCol(sheet, "Equipo",         fE);
  const cIM  = getCol(sheet, "IMEI",           fE);
  const cF1  = getCol(sheet, "Falla 1",        fE);
  const cF2  = getCol(sheet, "Falla 2",        fE);
  const cPC  = getCol(sheet, "Precio Cobrado", fE);
  const cEF  = getCol(sheet, "Cobrado Efectivo",      fE);
  const cTR  = getCol(sheet, "Cobrado Transferencia", fE);
  const cES  = getCol(sheet, "Estado",         fE);
  let cDNI = -1, cEML = -1, cCOL = -1, cTRAB = -1;
  try { cDNI  = getCol(sheet, "DNI Cliente",         fE); } catch (e) { /* opcional */ }
  try { cEML  = getCol(sheet, "Email Cliente",       fE); } catch (e) { /* opcional */ }
  try { cCOL  = getCol(sheet, "Color",               fE); } catch (e) { /* opcional */ }
  try { cTRAB = getCol(sheet, "Trabajos Reparación", fE); } catch (e) { /* opcional */ }

  const lastRow = sheet.getLastRow();
  if (lastRow <= fE) throw new Error(`❌ "${numero}" no encontrado en "Reparaciones".`);
  const datosR = sheet.getRange(fE + 1, 1, lastRow - fE, sheet.getLastColumn()).getValues();
  const fila = datosR.find(r => String(r[cNR - 1]).trim() === numero);
  if (!fila) throw new Error(`❌ "${numero}" no encontrado en "Reparaciones".`);

  const estado = String(fila[cES - 1] || "").trim();
  if (estado !== "✅ Retirado") {
    throw new Error(`❌ "${numero}" todavía no fue entregada (estado actual: "${estado || "—"}") — el comprobante de entrega solo corresponde una vez retirada.`);
  }

  const tz = Session.getScriptTimeZone();
  const fechaRaw = fila[cFE2 - 1];
  const fecha = fechaRaw instanceof Date ? Utilities.formatDate(fechaRaw, tz, "dd/MM/yyyy") : String(fechaRaw || "");

  let falla = String(fila[cF1 - 1] || "");
  if (fila[cF2 - 1]) falla += (falla ? " / " : "") + fila[cF2 - 1];

  const datos = {
    numero:    numero,
    fecha:     fecha,
    cliente:   String(fila[cCL - 1] || ""),
    tel:       String(fila[cTE - 1] || ""),
    dni:       cDNI > 0 ? String(fila[cDNI - 1] || "") : "",
    email:     cEML > 0 ? String(fila[cEML - 1] || "") : "",
    equipo:    String(fila[cEQ - 1] || ""),
    imei:      String(fila[cIM - 1] || ""),
    color:     cCOL > 0 ? String(fila[cCOL - 1] || "") : "",
    falla:     falla,
    trabajos:  cTRAB > 0 ? String(fila[cTRAB - 1] || "") : "",
    precio:    Number(fila[cPC - 1]) || 0,
    cobradoEf: Number(fila[cEF - 1]) || 0,
    cobradoTr: Number(fila[cTR - 1]) || 0
  };

  return _armarHtmlReciboEntregaReparacion_(datos);
}

/** Arma el HTML del comprobante de entrega. SOLO diseño — mismo sistema (1 hoja A4, firma estampada) que los demás recibos de recibos.gs. */
function _armarHtmlReciboEntregaReparacion_(d) {
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const neg = RECIBO_NEGOCIO;
  const linea = (ancho) => `<span class="linea" style="width:${ancho || 160}px"></span>`;
  const campo = (etiqueta, valor) => `<div class="campo"><span class="etiqueta">${etiqueta}:</span> <span class="valor">${valor}</span></div>`;

  const filaPago = (etiqueta, monto) =>
    `<div class="pago-fila"><span class="chk-box">${monto > 0 ? "☑" : "☐"}</span> <span class="pago-etiqueta">${etiqueta}:</span> ${monto > 0 ? `<b>${fmtPeso(monto)}</b>` : linea(150)}</div>`;

  const html = `
  <div class="hoja">
    <div class="encabezado">
      <div class="encabezado-izq">
        <div class="logo">${esc(neg.nombre)}</div>
        <div class="direccion">${esc(neg.direccion)} · ${esc(neg.ciudad)} · ${esc(neg.telefono)}</div>
      </div>
      <div class="encabezado-der">
        <div class="titulo-recibo">COMPROBANTE DE ENTREGA</div>
        <div class="dato-header">Ticket N°: <b>${esc(d.numero)}</b></div>
        <div class="dato-header">Fecha de entrega: <b>${esc(d.fecha)}</b></div>
      </div>
    </div>

    <div class="seccion-titulo">DATOS DEL DISPOSITIVO</div>
    <div class="dos-columnas">
      <div class="columna">
        ${campo("Marca/Modelo", `<b>${esc(d.equipo) || "—"}</b>`)}
        ${campo("Color", `<b>${esc(d.color) || linea(160)}</b>`)}
      </div>
      <div class="columna">
        ${campo("IMEI", `<b>${esc(d.imei) || linea(180)}</b>`)}
      </div>
    </div>

    <div class="seccion-titulo">DATOS DEL CLIENTE</div>
    <div class="dos-columnas">
      <div class="columna">
        ${campo("Apellido y Nombre", `<b>${esc(d.cliente) || linea(200)}</b>`)}
        ${campo("DNI", `<b>${esc(d.dni) || linea(160)}</b>`)}
      </div>
      <div class="columna">
        ${campo("Tel", `<b>${esc(d.tel) || linea(160)}</b>`)}
        ${campo("Email", `<b>${esc(d.email) || linea(180)}</b>`)}
      </div>
    </div>

    <div class="seccion-titulo">FALLA REPARADA</div>
    <div class="falla-box">${esc(d.falla) || "—"}${d.trabajos ? `<br><span style="color:var(--gris-texto);font-size:10.5px">Trabajos realizados: ${esc(d.trabajos)}</span>` : ""}</div>

    <div class="seccion-titulo">PRECIO Y COBRO TOTAL</div>
    <div class="pago-box">
      <div class="pago-total">
        <div class="pago-total-label">PRECIO TOTAL</div>
        <div class="pago-total-monto">${fmtPeso(d.precio)}</div>
        <div class="son-pesos">Son pesos: <b>${numeroAPesosEnLetras_(d.precio)}</b></div>
      </div>
      <div class="pago-detalle">
        <div class="pago-detalle-label">DETALLE DEL COBRO TOTAL (acumulado)</div>
        ${filaPago("Efectivo", d.cobradoEf)}
        ${filaPago("Transferencia", d.cobradoTr)}
      </div>
    </div>

    <div class="seccion-titulo">GARANTÍA DE LA REPARACIÓN</div>
    <div class="garantia-texto" style="font-style:normal">
      El trabajo realizado (mano de obra y repuestos utilizados) cuenta con una garantía de <b>90 (noventa) días</b> desde la fecha de esta entrega,
      exclusivamente sobre la falla reparada. La garantía NO cubre daños nuevos, golpes, líquido, ni manipulación posterior por parte de terceros.
      El cliente declara retirar el equipo reparado y conforme con el trabajo realizado.
    </div>

    <div class="firmas">
      <div class="firma-col">
        <img class="firma-img" src="data:image/png;base64,${RECIBO_FIRMA_TITULAR_BASE64}" alt="Firma">
        <div class="firma-linea"></div>
        <div class="firma-label">${esc(neg.nombre)} / ${esc(neg.titular)} — DNI ${esc(neg.dniTitular)}</div>
      </div>
      <div class="firma-col">
        <div class="firma-linea"></div>
        <div class="firma-label">Cliente — Aclaración y DNI</div>
      </div>
    </div>

    <div class="pie-separador"></div>
    <div class="pie">${esc(neg.nombre)} · ${esc(neg.direccion)}, ${esc(neg.ciudad)} · ${esc(neg.telefono)}</div>
  </div>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Entrega Reparación ${esc(d.numero)}</title>
<style>
  ${_cssBaseTicketReparacion_(`
  .encabezado { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 8px; }
  .logo { font-size: 26px; font-weight: bold; letter-spacing: .3px; }
  .direccion { font-size: 10.5px; color: var(--gris-texto); margin-top: 3px; }
  .encabezado-der { text-align: right; }
  .titulo-recibo { font-size: 20px; font-weight: bold; color: var(--naranja); letter-spacing: .5px; margin-bottom: 6px; }
  .dato-header { font-size: 11.5px; margin-top: 2px; }
  `)}
</style>
</head>
<body>
  ${html}
  <script>
    window.onload = function () {
      window.print();
    };
  </script>
</body>
</html>`;
}

// ============================================================
//  Comprobante de Entrega — Preventa. Mismo patrón que el resto de
//  recibos.gs. Se emite una vez que la preventa ya tuvo al menos una
//  entrega (procesarEntregaPreventa, Code.gs) — ahí es donde arranca de
//  verdad la garantía de 12 meses (no desde que se pagó la seña), así que
//  reutiliza el mismo texto legal completo del recibo de Venta/Preventa.
//  Muestra el desglose Precio Total / Seña abonada (capturada una sola
//  vez en la primera entrega, ver "Seña Abonada (Preventa)" en
//  procesarEntregaPreventa) / Cobrado en la(s) entrega(s) / Saldo
//  pendiente (si la entrega fue parcial).
// ============================================================

/**
 * generarReciboEntregaPreventa(numeroPreventa)
 *
 * Busca la preventa por su N° Preventa en "Preventas" — debe estar
 * "✅ Entregado" o "🟢 Entregado con saldo" (ya tuvo al menos una entrega)
 * — y arma el comprobante imprimible (una hoja A4). Completa IMEI/Color
 * desde la Venta asociada (N° Venta Asociada) si existe, ya que la
 * Preventa en sí no guarda esos datos del equipo físico entregado.
 */
function generarReciboEntregaPreventa(numeroPreventa) {
  const numero = String(numeroPreventa || "").trim();
  if (!numero) throw new Error("❌ Falta el número de preventa.");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Preventas");
  if (!sheet) throw new Error("❌ Hoja 'Preventas' no encontrada.");

  const fE = 2;
  const cNP  = getCol(sheet, "N° Preventa",          fE);
  const cCL  = getCol(sheet, "Cliente",               fE);
  const cTL  = getCol(sheet, "Teléfono",              fE);
  const cMO  = getCol(sheet, "Modelo Solicitado",     fE);
  const cPV  = getCol(sheet, "Precio Venta Pactado",  fE);
  const cTC  = getCol(sheet, "Total Cobrado",         fE);
  const cSP  = getCol(sheet, "Saldo Pendiente",       fE);
  const cES  = getCol(sheet, "Estado",                fE);
  const cNV  = getCol(sheet, "N° Venta Asociada",     fE);
  let cCUIL = -1, cDOM = -1, cEML = -1, cSENA = -1, cFUE = -1, cVend = -1;
  try { cCUIL = getCol(sheet, "CUIL Cliente",              fE); } catch (e) { /* opcional */ }
  try { cDOM  = getCol(sheet, "Domicilio Cliente",         fE); } catch (e) { /* opcional */ }
  try { cEML  = getCol(sheet, "Email Cliente",             fE); } catch (e) { /* opcional */ }
  try { cSENA = getCol(sheet, "Seña Abonada (Preventa)",   fE); } catch (e) { /* opcional */ }
  try { cFUE  = getCol(sheet, "Fecha Última Entrega",      fE); } catch (e) { /* opcional */ }
  try { cVend = getCol(sheet, "Vendedor",                  fE); } catch (e) { /* opcional */ }

  const lastRow = sheet.getLastRow();
  if (lastRow <= fE) throw new Error(`❌ "${numero}" no encontrado en "Preventas".`);
  const datosP = sheet.getRange(fE + 1, 1, lastRow - fE, sheet.getLastColumn()).getValues();
  const fila = datosP.find(r => String(r[cNP - 1]).trim() === numero);
  if (!fila) throw new Error(`❌ "${numero}" no encontrado en "Preventas".`);

  const estado = String(fila[cES - 1] || "").trim();
  if (estado !== "✅ Entregado" && estado !== "🟢 Entregado con saldo") {
    throw new Error(`❌ "${numero}" todavía no fue entregada (estado actual: "${estado || "—"}") — el comprobante de entrega solo corresponde después de la entrega.`);
  }

  const tz = Session.getScriptTimeZone();
  const fechaRaw = cFUE > 0 ? fila[cFUE - 1] : null;
  const fecha = fechaRaw instanceof Date ? Utilities.formatDate(fechaRaw, tz, "dd/MM/yyyy") : Utilities.formatDate(new Date(), tz, "dd/MM/yyyy");

  const cuil = cCUIL > 0 ? String(fila[cCUIL - 1] || "") : "";
  const precioTotal = Number(fila[cPV - 1]) || 0;
  const totalCobrado = Number(fila[cTC - 1]) || 0;
  const senaAbonada = cSENA > 0 ? (Number(fila[cSENA - 1]) || 0) : 0;

  const datos = {
    numero:        numero,
    fecha:         fecha,
    vendedor:      cVend > 0 ? String(fila[cVend - 1] || "") : "",
    cliente:       String(fila[cCL - 1] || ""),
    cuil:          cuil,
    dni:           extraerDniDeCuil_(cuil),
    domicilio:     cDOM > 0 ? String(fila[cDOM - 1] || "") : "",
    email:         cEML > 0 ? String(fila[cEML - 1] || "") : "",
    tel:           String(fila[cTL - 1] || ""),
    modelo:        String(fila[cMO - 1] || ""),
    imei:          "",
    color:         "",
    precioTotal:   precioTotal,
    senaAbonada:   senaAbonada,
    cobradoEntrega: Math.max(0, totalCobrado - senaAbonada),
    saldoPendiente: Number(fila[cSP - 1]) || 0
  };

  // IMEI/Color reales del equipo entregado: viven en Ventas (o en Compras
  // detrás de esa Venta), no en Preventas — se completan solo si hay N° de
  // Venta asociada (siempre debería haberla luego de la primera entrega).
  const nVta = cNV > 0 ? String(fila[cNV - 1] || "").trim() : "";
  if (nVta) {
    const ventasSheet = ss.getSheetByName("Ventas");
    if (ventasSheet) {
      const fEV = 2;
      let cNVv = -1, cMOv = -1, cIMv = -1, cNOPv = -1;
      try { cNVv  = getCol(ventasSheet, "N° Venta",     fEV); } catch (e) { /* opcional */ }
      try { cMOv  = getCol(ventasSheet, "Modelo",       fEV); } catch (e) { /* opcional */ }
      try { cIMv  = getCol(ventasSheet, "IMEI",         fEV); } catch (e) { /* opcional */ }
      try { cNOPv = getCol(ventasSheet, "N° OP Compra", fEV); } catch (e) { /* opcional */ }
      const lastV = ventasSheet.getLastRow();
      if (cNVv > 0 && lastV > fEV) {
        const filaV = ventasSheet.getRange(fEV + 1, 1, lastV - fEV, ventasSheet.getLastColumn())
          .getValues()
          .find(r => String(r[cNVv - 1]).trim() === nVta);
        if (filaV) {
          if (cMOv > 0 && filaV[cMOv - 1]) datos.modelo = String(filaV[cMOv - 1]);
          if (cIMv > 0) datos.imei = String(filaV[cIMv - 1] || "");
          const nOpCompra = cNOPv > 0 ? String(filaV[cNOPv - 1] || "").trim() : "";
          if (nOpCompra) {
            const comprasSheet = ss.getSheetByName("Compras");
            if (comprasSheet) {
              const fEC = 2;
              let cOPc = -1, cColorc = -1;
              try { cOPc    = getCol(comprasSheet, "N° OP",  fEC); } catch (e) { /* opcional */ }
              try { cColorc = getCol(comprasSheet, "Color",  fEC); } catch (e) { /* opcional */ }
              const lastC = comprasSheet.getLastRow();
              if (cOPc > 0 && lastC > fEC) {
                const filaC = comprasSheet.getRange(fEC + 1, 1, lastC - fEC, comprasSheet.getLastColumn())
                  .getValues()
                  .find(r => String(r[cOPc - 1]).trim() === nOpCompra);
                if (filaC && cColorc > 0) datos.color = String(filaC[cColorc - 1] || "");
              }
            }
          }
        }
      }
    }
  }

  // Accesorios de la entrega: comprados por el cliente (cobrados junto con
  // el saldo, ver procesarEntregaPreventa/registrarAccesorioAsociado_) y
  // regalos automáticos (cable/funda — entregarRegalosAutomaticos_(),
  // operadores.gs: se entregan recién en la ENTREGA, no en la preventa).
  // Ambos quedan en "Venta Accesorios" ligados a la Venta generada por esta
  // entrega, así que se leen de ahí — solo lectura, no participa de ningún
  // cálculo de caja.
  datos.comprados = [];
  datos.regalos = [];
  if (nVta) {
    const accSheet = ss.getSheetByName("Venta Accesorios");
    if (accSheet) {
      const fEA = 2;
      let cNVC = -1, cCAT = -1, cPRD = -1, cTCa = -1, cObsAcc = -1;
      try { cNVC = getCol(accSheet, "N° Venta Celular Asociada", fEA); } catch (e) { /* opcional */ }
      try { cCAT = getCol(accSheet, "Categoría",                 fEA); } catch (e) { /* opcional */ }
      try { cPRD = getCol(accSheet, "Producto",                  fEA); } catch (e) { /* opcional */ }
      try { cTCa = getCol(accSheet, "Total Cobrado",              fEA); } catch (e) { /* opcional */ }
      try { cObsAcc = getCol(accSheet, "Observaciones",          fEA); } catch (e) { /* opcional */ }
      const lastA = accSheet.getLastRow();
      if (cPRD > 0 && lastA > fEA) {
        // Mismo plan B que generarReciboVenta(): si "N° Venta Celular
        // Asociada" vino vacía, buscar el texto "venta celular <N° Venta>"
        // que registrarAccesorioAsociado_() siempre escribe en Observaciones.
        const patronObsEP = new RegExp("venta celular\\s+" + nVta.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
        accSheet.getRange(fEA + 1, 1, lastA - fEA, accSheet.getLastColumn()).getValues()
          .filter(r => {
            const asocOk = cNVC > 0 && String(r[cNVC - 1] || "").trim() === nVta;
            const obsOk  = cObsAcc > 0 && patronObsEP.test(String(r[cObsAcc - 1] || ""));
            return asocOk || obsOk;
          })
          .forEach(r => {
            const producto = String(r[cPRD - 1] || "");
            if (!producto) return;
            const categoria = cCAT > 0 ? String(r[cCAT - 1] || "") : "";
            if (categoria === "Regalo automático") {
              datos.regalos.push(producto);
            } else {
              datos.comprados.push({ producto: producto, precio: cTCa > 0 ? (Number(r[cTCa - 1]) || 0) : 0 });
            }
          });
      }
    }
  }

  return _armarHtmlReciboEntregaPreventa_(datos);
}

/** Arma el HTML del comprobante de entrega de preventa. SOLO diseño — mismo sistema (1 hoja A4, firma estampada) que los demás recibos de recibos.gs. */
function _armarHtmlReciboEntregaPreventa_(d) {
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const neg = RECIBO_NEGOCIO;
  const linea = (ancho) => `<span class="linea" style="width:${ancho || 160}px"></span>`;
  const campo = (etiqueta, valor) => `<div class="campo"><span class="etiqueta">${etiqueta}:</span> <span class="valor">${valor}</span></div>`;

  const html = `
  <div class="hoja">
    <div class="encabezado">
      <div class="encabezado-izq">
        <div class="logo">${esc(neg.nombre)}</div>
        <div class="direccion">${esc(neg.direccion)} · ${esc(neg.ciudad)}</div>
        <div class="direccion">Tel: ${esc(neg.telefono)}</div>
      </div>
      <div class="encabezado-der">
        <div class="titulo-recibo">COMPROBANTE DE ENTREGA</div>
        <div class="dato-header">N° Preventa: <b>${esc(d.numero)}</b></div>
        <div class="dato-header">Fecha de entrega: <b>${esc(d.fecha)}</b></div>
        <div class="dato-header">Vendedor: <b>${esc(d.vendedor) || linea(110)}</b></div>
      </div>
    </div>

    <div class="seccion-titulo">DATOS DEL DISPOSITIVO ENTREGADO</div>
    <div class="dos-columnas">
      <div class="columna">
        ${campo("Marca/Modelo", `<b>${esc(d.modelo) || "—"}</b>`)}
        ${campo("Color", `<b>${esc(d.color) || linea(140)}</b>`)}
      </div>
      <div class="columna">
        ${campo("IMEI", `<b>${esc(d.imei) || linea(180)}</b>`)}
      </div>
    </div>

    <div class="seccion-titulo">DATOS DEL COMPRADOR</div>
    <div class="dos-columnas comprador">
      <div class="columna">
        ${campo("Apellido y Nombre", `<b>${esc(d.cliente) || linea(160)}</b>`)}
        ${campo("DNI", `<b>${esc(d.dni) || linea(140)}</b>`)}
        ${campo("CUIL / CUIT", `<b>${esc(d.cuil) || linea(140)}</b>`)}
      </div>
      <div class="columna">
        ${campo("Teléfono", `<b>${esc(d.tel) || linea(140)}</b>`)}
        ${campo("Domicilio", `<b>${esc(d.domicilio) || linea(140)}</b>`)}
        ${campo("Email", `<b>${esc(d.email) || linea(140)}</b>`)}
      </div>
    </div>

    ${(d.comprados.length > 0 || d.regalos.length > 0) ? `
    <div class="seccion-titulo">ACCESORIOS Y REGALOS ENTREGADOS</div>
    <div class="dos-columnas">
      ${d.comprados.length > 0 ? `
      <div class="columna">
        <div class="campo"><span class="etiqueta">Comprados en esta entrega:</span></div>
        ${d.comprados.map(a => `<div class="campo">• ${esc(a.producto)}${a.precio > 0 ? ` — <b>${fmtPeso(a.precio)}</b>` : ""}</div>`).join("")}
      </div>` : ""}
      ${d.regalos.length > 0 ? `
      <div class="columna">
        <div class="campo"><span class="etiqueta">Regalo/s incluido/s:</span></div>
        ${d.regalos.map(r => `<div class="campo">🎁 ${esc(r)}</div>`).join("")}
      </div>` : ""}
    </div>` : ""}

    <div class="seccion-titulo">RESUMEN DE PAGO</div>
    <div class="pago-box">
      <div class="pago-total">
        <div class="pago-total-label">PRECIO TOTAL</div>
        <div class="pago-total-monto">${fmtPeso(d.precioTotal)}</div>
        <div class="son-pesos">Son pesos: <b>${numeroAPesosEnLetras_(d.precioTotal)}</b></div>
      </div>
      <div class="pago-detalle">
        <div class="pago-detalle-label">DETALLE</div>
        <div class="pago-fila"><span class="pago-etiqueta">Seña abonada (preventa):</span> <b>${fmtPeso(d.senaAbonada)}</b></div>
        <div class="pago-fila"><span class="pago-etiqueta">Cobrado en esta entrega:</span> <b>${fmtPeso(d.cobradoEntrega)}</b></div>
        <div class="pago-fila" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--gris)"><span class="pago-etiqueta">Total cobrado:</span> <b>${fmtPeso(d.senaAbonada + d.cobradoEntrega)}</b></div>
        ${d.saldoPendiente > 0 ? `<div class="pago-fila" style="color:#C0392B"><span class="pago-etiqueta">⚠️ Saldo pendiente:</span> <b>${fmtPeso(d.saldoPendiente)}</b></div>` : ""}
      </div>
    </div>

    <div class="seccion-titulo">GARANTÍA</div>
    <div class="garantia">
      <p>El equipo adquirido cuenta con una garantía de <b>${neg.garantiaMeses} (doce) meses</b> desde la fecha de entrega efectiva al comprador.
      La garantía cubre únicamente fallas técnicas de origen no provocadas por el cliente, incluyendo problemas de encendido, fallas internas de pantalla,
      batería defectuosa de origen, fallas de software persistentes, problemas de carga, audio, cámara o conectividad. Toda garantía queda sujeta a
      diagnóstico y verificación técnica por parte del local.</p>
      <p>La garantía NO cubre: pantallas rotas, fisuradas o con daño físico; golpes, rayones, deformaciones o daños estéticos; daño por líquido o humedad;
      equipos abiertos, manipulados o reparados por terceros; daños ocasionados por accesorios no originales o uso incorrecto; problemas relacionados con
      cuentas, contraseñas o bloqueos del usuario; daños eléctricos externos; fallas posteriores al vencimiento del plazo de garantía. Si el equipo
      presenta evidencia física de golpe, humedad o manipulación externa, la garantía quedará automáticamente anulada.</p>
      <p>En caso de ingreso por garantía: 1) El equipo será evaluado técnicamente. 2) El local determinará si corresponde garantía según el diagnóstico
      realizado. 3) Si corresponde garantía, el local podrá optar por: reparación, reemplazo del equipo, o devolución del dinero abonado (última instancia).</p>
      <p>El cliente declara haber recibido el equipo en correcto estado de funcionamiento y haber leído y aceptado las presentes condiciones de garantía.</p>
    </div>

    <div class="firmas">
      <div class="firma-col">
        <img class="firma-img" src="data:image/png;base64,${RECIBO_FIRMA_TITULAR_BASE64}" alt="Firma">
        <div class="firma-linea"></div>
        <div class="firma-label">${esc(neg.nombre)} / ${esc(neg.titular)} — DNI ${esc(neg.dniTitular)}</div>
      </div>
      <div class="firma-col">
        <div class="firma-linea"></div>
        <div class="firma-label">Comprador — Aclaración y DNI</div>
      </div>
    </div>

    <div class="pie-separador"></div>
    <div class="pie">Al firmar, el comprador declara recibir el equipo en conformidad con lo descripto. ${esc(neg.nombre)} · ${esc(neg.direccion)}, ${esc(neg.ciudad)} · ${esc(neg.telefono)}</div>
  </div>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Entrega Preventa ${esc(d.numero)}</title>
<style>
  :root { --naranja: #E07B1E; --gris: #D9D9D9; --gris-texto: #6B6B6B; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; font-size: 11.5px; }

  .hoja { width: 190mm; padding: 4mm 12mm; margin: 0 auto; }

  .encabezado { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 8px; }
  .logo { font-size: 26px; font-weight: bold; letter-spacing: .3px; }
  .direccion { font-size: 10.5px; color: var(--gris-texto); margin-top: 3px; }
  .encabezado-der { text-align: right; }
  .titulo-recibo { font-size: 20px; font-weight: bold; color: var(--naranja); letter-spacing: .5px; margin-bottom: 6px; }
  .dato-header { font-size: 11.5px; margin-top: 2px; }

  .seccion-titulo {
    font-weight: bold; font-size: 12px; text-transform: uppercase; letter-spacing: .4px;
    margin: 12px 0 7px; padding-bottom: 4px; border-bottom: 3px solid var(--naranja);
  }

  .dos-columnas { display: flex; gap: 40px; }
  .dos-columnas .columna { flex: 1; display: flex; flex-direction: column; gap: 7px; }
  .dos-columnas.comprador { position: relative; }
  .dos-columnas.comprador::after {
    content: ""; position: absolute; top: 2px; bottom: 2px; left: 50%;
    width: 1px; background: var(--gris); margin-left: -20px;
  }
  .campo { font-size: 11.5px; }
  .etiqueta { font-weight: bold; }

  .linea { display: inline-block; border-bottom: 1px solid #1a1a1a; height: 12px; vertical-align: bottom; margin: 0 2px; }

  .pago-box { display: flex; border: 2px solid var(--naranja); margin-top: 4px; }
  .pago-total { flex: 0 0 34%; text-align: center; padding: 10px 14px; border-right: 1px solid var(--gris); }
  .pago-total-label { font-size: 11px; font-weight: bold; letter-spacing: .3px; }
  .pago-total-monto { font-size: 24px; font-weight: bold; margin-top: 8px; }
  .son-pesos { font-size: 10px; color: var(--gris-texto); margin-top: 8px; }
  .pago-detalle { flex: 1; padding: 10px 20px; }
  .pago-detalle-label { font-weight: bold; font-size: 11px; letter-spacing: .3px; margin-bottom: 8px; }
  .pago-fila { margin: 5px 0; font-size: 11.5px; }
  .pago-etiqueta { font-weight: bold; }

  .garantia { font-size: 8.5px; line-height: 1.4; text-align: justify; color: #2b2b2b; }
  .garantia p { margin: 0 0 5px; }

  .firmas { display: flex; gap: 50px; margin-top: 55px; }
  .firma-col { flex: 1; text-align: center; position: relative; }
  .firma-linea { border-top: 1px solid #1a1a1a; margin-bottom: 6px; margin-top: 85px; }
  .firma-label { font-size: 10.5px; font-weight: bold; }
  .firma-img { position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%); height: 95px; width: auto; }

  .pie-separador { border-top: 1px solid var(--gris); margin-top: 8px; }
  .pie { text-align: center; font-size: 8.5px; color: var(--gris-texto); margin-top: 4px; }

  @page { size: A4; margin: 4mm 8mm; }
  @media print { .hoja { width: 100%; } }
</style>
</head>
<body>
  ${html}
  <script>
    window.onload = function () {
      window.print();
    };
  </script>
</body>
</html>`;
}

// ============================================================
//  FIRMA DIGITAL DEL CLIENTE + ENVÍO POR WHATSAPP
//  Muchos recibos ya no se imprimen en papel: el cliente firma en la
//  pantalla del empleado (canvas, ver firma_cliente.html) y el recibo se
//  manda como PDF por WhatsApp. Esto NO reemplaza la impresión (sigue
//  intacta) — es un camino nuevo, en paralelo, que reutiliza el mismo HTML
//  que ya generaba cada recibo (ninguna de las funciones generarReciboXxx()
//  de arriba fue modificada).
// ============================================================

/**
 * Inserta la firma del cliente (PNG en base64) en el recibo ya armado.
 * Busca el bloque .firma-col del lado del cliente/vendedor-particular (el
 * que NO tiene <img> de la firma del negocio — esa es siempre la primera
 * coincidencia de este patrón en cualquiera de las 7 plantillas de este
 * archivo, ver comentario de generarReciboPdfConFirma) e inyecta la imagen
 * ahí, con el mismo estilo .firma-img que ya usa la firma del negocio.
 */
function _insertarFirmaClienteEnHtml_(html, firmaClienteBase64) {
  if (!firmaClienteBase64) return html;
  const patron = /<div class="firma-col">(\s*)<div class="firma-linea">/;
  const imgTag = `<img class="firma-img" src="data:image/png;base64,${firmaClienteBase64}" alt="Firma cliente">`;
  return html.replace(patron, (m, espacio) => `<div class="firma-col">${espacio}${imgTag}<div class="firma-linea">`);
}

/** Convierte el HTML de un recibo a PDF y lo devuelve en base64 — sin pasar por Drive, listo para que el navegador lo baje directo al dispositivo del empleado. La conversión de Apps Script no es pixel-perfect vs. un navegador real, pero para estas plantillas (tablas, bordes, texto) funciona bien. */
function _htmlAPdfBase64_(html, nombreArchivo) {
  const blob = Utilities.newBlob(html, "text/html", (nombreArchivo || "recibo") + ".html");
  const pdfBlob = blob.getAs("application/pdf").setName((nombreArchivo || "recibo") + ".pdf");
  return Utilities.base64Encode(pdfBlob.getBytes());
}

/**
 * generarReciboPdfConFirma(d)
 * d = { tipo, numero, firmaClienteBase64 }
 * tipo ∈ "VENTA" | "PREVENTA" | "CESION" | "REPARACION" | "ENTREGA_REPARACION" | "ENTREGA_PREVENTA"
 *
 * Punto de entrada único para el botón "📲 Firmar y enviar por WhatsApp":
 * arma el mismo HTML que ya arma cada generarReciboXxx() existente (sin
 * tocar ninguna), le mete la firma del cliente si vino, lo convierte a PDF
 * y devuelve { pdfBase64, nombreArchivo } para que el frontend lo baje y
 * abra WhatsApp.
 */
function generarReciboPdfConFirma(d) {
  const tipo = String((d && d.tipo) || "").trim().toUpperCase();
  const numero = String((d && d.numero) || "").trim();
  const firma = (d && d.firmaClienteBase64) || "";
  if (!numero) throw new Error("❌ Falta el número de operación.");

  let html;
  switch (tipo) {
    case "VENTA":               html = generarReciboVenta(numero); break;
    case "PREVENTA":            html = generarReciboPreventa(numero); break;
    case "CESION":               html = generarReciboCesion(numero); break;
    case "REPARACION":           html = generarReciboReparacion(numero); break;
    case "ENTREGA_REPARACION":  html = generarReciboEntregaReparacion(numero); break;
    case "ENTREGA_PREVENTA":    html = generarReciboEntregaPreventa(numero); break;
    default: throw new Error(`❌ Tipo de recibo "${tipo}" no reconocido.`);
  }

  html = _insertarFirmaClienteEnHtml_(html, firma);
  const nombreArchivo = `Recibo_${tipo}_${numero}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  return { pdfBase64: _htmlAPdfBase64_(html, nombreArchivo), nombreArchivo: nombreArchivo + ".pdf" };
}
