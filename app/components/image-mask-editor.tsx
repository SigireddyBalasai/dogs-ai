"use client";
import React, { useState, useRef, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import Image from 'next/image';
import { Upload, Download, Image as ImageIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectItem, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select';
import { uploadToCloudflare } from './service';
import JSZip from 'jszip';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

const PaymentForm = ({ onSuccess }: { onSuccess: () => void }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setProcessing(true);
    const { error: submitError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: window.location.origin,
      },
      redirect: 'if_required',
    });

    if (submitError) {
      setError(submitError.message || 'Payment failed');
      setProcessing(false);
    } else {
      onSuccess();
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement />
      <Button type="submit" disabled={!stripe || processing} className="mt-4 w-full">
        {processing ? 'Processing...' : 'Pay for Image Processing'}
      </Button>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    </form>
  );
};

const ImageMaskEditor = () => {
  const [image, setImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [city, setCity] = useState('Eiffel Tower (Paris, France)');
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  const [hasPaid, setHasPaid] = useState(false);

  const imageCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const initializeCanvases = (imageUrl: string): Promise<void> => {
    return new Promise((resolve) => {
      const img = new window.Image();
      img.onload = () => {
        const maxWidth = 1024;
        const maxHeight = 1024;
        let newWidth = img.width;
        let newHeight = img.height;

        if (newWidth > maxWidth) {
          newWidth = maxWidth;
          newHeight = (img.height * maxWidth) / img.width;
        }
        if (newHeight > maxHeight) {
          newHeight = maxHeight;
          newWidth = (img.width * maxHeight) / img.height;
        }

        setImageSize({
          width: newWidth,
          height: newHeight
        });

        if (imageCanvasRef.current) {
          const imageCanvas = imageCanvasRef.current;
          const imageCtx = imageCanvas.getContext('2d');

          imageCanvas.width = newWidth;
          imageCanvas.height = newHeight;
          imageCtx?.drawImage(img, 0, 0, newWidth, newHeight);
        }

        resolve();
      };
      img.src = imageUrl;
    });
  };

  useEffect(() => {
    if (image) {
      initializeCanvases(image);
    }
  }, [image]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        setError('Image size should be less than 10MB');
        return;
      }

      const reader = new FileReader();
      reader.onload = async (event) => {
        if (event.target?.result) {
          setImage(event.target.result as string);
        }
        setError(null);
      };
      reader.onerror = () => {
        setError('Error reading file');
      };
      reader.readAsDataURL(file);
    }
  };

  const processImage = async (imageUrl: string) => {
    setIsProcessing(true);
    setError(null);
    try {
      const response = await fetch('http://0.0.0.0:5000/outpaint', {
        method: 'POST',
        body: JSON.stringify({
          image: imageUrl,
          location: city,
          tourist_spot: 'Eiffel Tower',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });
  
      if (!response.ok) throw new Error(`Failed to process image: ${response.statusText}`);
  
      const blob = await response.blob();
      const zipFilePath = URL.createObjectURL(blob);
      const zipResponse = await fetch(zipFilePath);
      const zipBlob = await zipResponse.blob();
      const zipFile = new File([zipBlob], 'outpainted_output.zip', { type: zipBlob.type });
  
      const zip = await JSZip.loadAsync(zipFile);
      const files = Object.keys(zip.files);
      if (files.length > 0) {
        const resultBlob = await zip.files[files[0]].async('blob');
        const resultUrl = URL.createObjectURL(resultBlob);
        setResult(resultUrl);
      } else {
        throw new Error('No files found in the zip');
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message || 'Failed to process image');
      } else {
        setError('Failed to process image');
      }
    } finally {
      setIsProcessing(false);
    }
  };
  
  const handlePaymentAndProcessImage = async () => {
    if (!image) {
      setError('Please provide an image.');
      return;
    }
  
    setError(null);
  
    try {
      const imageBlob = await fetch(image).then((res) => res.blob());
      const imageFile = new File([imageBlob], 'image.png', { type: imageBlob.type });
      const imageUrl = await uploadToCloudflare(imageFile);
  
      if (!hasPaid) {
        // Create payment intent first
        const paymentResponse = await fetch('/api/create-payment-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: 500 }), // $5.00 for image processing
        });
  
        const { clientSecret: secret } = await paymentResponse.json();
        setClientSecret(secret);
      } else {
        // Process image if already paid
        processImage(imageUrl);
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message || 'Failed to prepare image for processing');
      } else {
        setError('Failed to prepare image for processing');
      }
    }
  };

  const downloadImage = (dataUrl: string, filename: string) => {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadResult = () => {
    if (!result) return;
    downloadImage(result, 'result.png');
  };

  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle>Image Mask Editor</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {!image ? (
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
                id="image-upload"
              />
              <label
                htmlFor="image-upload"
                className="flex flex-col items-center cursor-pointer"
              >
                <ImageIcon className="w-12 h-12 mb-2 text-gray-400" />
                <span>Click to upload an image (max 10MB)</span>
              </label>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                <div className="relative border rounded-lg overflow-hidden">
                  <canvas
                    ref={imageCanvasRef}
                    style={{
                      maxWidth: '100%',
                      width: imageSize.width > 0 ? `${imageSize.width}px` : 'auto',
                      height: imageSize.height > 0 ? `${imageSize.height}px` : 'auto',
                      position: 'absolute',
                      top: 0,
                      left: 0,
                    }}
                  />
                </div>
  
                <Select
                  value={city}
                  onValueChange={(value) => setCity(value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a city" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Angkor Wat (Cambodia)">Angkor Wat (Cambodia)</SelectItem>
                    <SelectItem value="Big Ben and Parliament (London, UK)">Big Ben and Parliament (London, UK)</SelectItem>
                    <SelectItem value="Burj Khalifa (Dubai, UAE)">Burj Khalifa (Dubai, UAE)</SelectItem>
                    <SelectItem value="Central Park (New York, USA)">Central Park (New York, USA)</SelectItem>
                    <SelectItem value="Christ the Redeemer (Rio de Janeiro, Brazil)">Christ the Redeemer (Rio de Janeiro, Brazil)</SelectItem>
                    <SelectItem value="Colosseum (Rome, Italy)">Colosseum (Rome, Italy)</SelectItem>
                    <SelectItem value="Disney World (Orlando, USA)">Disney World (Orlando, USA)</SelectItem>
                    <SelectItem value="Eiffel Tower (Paris, France)">Eiffel Tower (Paris, France)</SelectItem>
                    <SelectItem value="Forbidden City (Beijing, China)">Forbidden City (Beijing, China)</SelectItem>
                    <SelectItem value="Golden Gate Bridge (San Francisco, USA)">Golden Gate Bridge (San Francisco, USA)</SelectItem>
                    <SelectItem value="Grand Canyon (Arizona, USA)">Grand Canyon (Arizona, USA)</SelectItem>
                    <SelectItem value="Great Barrier Reef (Australia)">Great Barrier Reef (Australia)</SelectItem>
                    <SelectItem value="Great Wall of China (China)">Great Wall of China (China)</SelectItem>
                    <SelectItem value="Hagia Sophia (Istanbul, Turkey)">Hagia Sophia (Istanbul, Turkey)</SelectItem>
                    <SelectItem value="Hollywood Walk of Fame (Los Angeles, USA)">Hollywood Walk of Fame (Los Angeles, USA)</SelectItem>
                    <SelectItem value="Leaning Tower of Pisa (Pisa, Italy)">Leaning Tower of Pisa (Pisa, Italy)</SelectItem>
                    <SelectItem value="Louvre Museum (Paris, France)">Louvre Museum (Paris, France)</SelectItem>
                    <SelectItem value="Machu Picchu (Peru)">Machu Picchu (Peru)</SelectItem>
                    <SelectItem value="Mount Everest (Nepal/Tibet)">Mount Everest (Nepal/Tibet)</SelectItem>
                    <SelectItem value="Mount Fuji (Japan)">Mount Fuji (Japan)</SelectItem>
                    <SelectItem value="Notre Dame Cathedral (Paris, France)">Notre Dame Cathedral (Paris, France)</SelectItem>
                    <SelectItem value="Opera House (Sydney, Australia)">Opera House (Sydney, Australia)</SelectItem>
                    <SelectItem value="Palace of Versailles (Versailles, France)">Palace of Versailles (Versailles, France)</SelectItem>
                    <SelectItem value="Petra (Jordan)">Petra (Jordan)</SelectItem>
                    <SelectItem value="Pyramids of Giza (Egypt)">Pyramids of Giza (Egypt)</SelectItem>
                    <SelectItem value="Puerta de Alcalá (Madrid, Spain)">Puerta de Alcalá (Madrid, Spain)</SelectItem>
                    <SelectItem value="Puerta de Brandeburgo (Berlin, Germany)">Puerta de Brandeburgo (Berlin, Germany)</SelectItem>
                    <SelectItem value="Santorini (Greece)">Santorini (Greece)</SelectItem>
                    <SelectItem value="Sagrada Familia (Barcelona, Spain)">Sagrada Familia (Barcelona, Spain)</SelectItem>
                    <SelectItem value="Statue of Liberty (New York, USA)">Statue of Liberty (New York, USA)</SelectItem>
                    <SelectItem value="Stonehenge (England, UK)">Stonehenge (England, UK)</SelectItem>
                    <SelectItem value="Taj Mahal (Agra, India)">Taj Mahal (Agra, India)</SelectItem>
                    <SelectItem value="Times Square (New York, USA)">Times Square (New York, USA)</SelectItem>
                    <SelectItem value="Tokyo Tower (Tokyo, Japan)">Tokyo Tower (Tokyo, Japan)</SelectItem>
                    <SelectItem value="Uluru (Ayers Rock, Australia)">Uluru (Ayers Rock, Australia)</SelectItem>
                    <SelectItem value="Vatican Museums (Vatican City)">Vatican Museums (Vatican City)</SelectItem>
                    <SelectItem value="Venice Canals (Venice, Italy)">Venice Canals (Venice, Italy)</SelectItem>
                    <SelectItem value="Victoria Falls (Zambia/Zimbabwe)">Victoria Falls (Zambia/Zimbabwe)</SelectItem>
                    <SelectItem value="Yellowstone National Park (USA)">Yellowstone National Park (USA)</SelectItem>
                    <SelectItem value="Yosemite National Park (USA)">Yosemite National Park (USA)</SelectItem>
                  </SelectContent>
                </Select>
  
                {clientSecret && !paid ? (
                  <div className="w-full">
                    <Elements stripe={stripePromise} options={{ clientSecret }}>
                      <PaymentForm onSuccess={() => {
                        setPaid(true);
                        setHasPaid(true); // Set hasPaid to true after successful payment
                        handlePaymentAndProcessImage();
                      }} />
                    </Elements>
                  </div>
                ) : (
                  <Button
                    onClick={() => handlePaymentAndProcessImage()}
                    disabled={isProcessing}
                    className="w-full"
                  >
                    {isProcessing ? 'Processing...' : (
                      <>
                        <Upload className="w-4 h-4 mr-2" />
                        Process Image {hasPaid ? '' : '($5.00)'}
                      </>
                    )}
                  </Button>
                )}
              </div>
  
              {result && (
                <>
                  <Image
                    src={result}
                    alt="Processed result"
                    className="w-full rounded-lg"
                    width={imageSize.width}
                    height={imageSize.height}
                  />
                  <Button onClick={downloadResult} className="w-full">
                    <Download className="w-4 h-4 mr-2" />
                    Download Result
                  </Button>
                </>
              )}
            </>
          )}
  
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
export default ImageMaskEditor;
